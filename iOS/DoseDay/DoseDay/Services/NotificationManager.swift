import Foundation
import SwiftData
import UserNotifications

/// Schedules dose reminders and handles the actions on them.
///
/// Reminders are one-off notifications for the next unlogged doses (see
/// `ReminderPlanner`), rebuilt whenever data changes or the app becomes active.
/// Doses that were already taken never trigger a reminder.
@MainActor
final class NotificationManager: NSObject, ObservableObject {
    static let shared = NotificationManager()

    /// UserDefaults key: hide medication names on the Lock Screen.
    static let hideNamesKey = "hideNamesInReminders"
    static let snoozeMinutes = 10

    @Published private(set) var authorization: UNAuthorizationStatus = .notDetermined

    private let center = UNUserNotificationCenter.current()
    private var latestRefresh: Task<Void, Never>?

    private enum ID {
        static let category = "DOSE_REMINDER"
        static let takeAction = "TAKE"
        static let snoozeAction = "SNOOZE"
        static let dosePrefix = "dose."
        static let snoozePrefix = "snooze."

        static func dose(_ key: DoseKey) -> String { dosePrefix + suffix(key) }
        static func snooze(_ key: DoseKey) -> String { snoozePrefix + suffix(key) }
        private static func suffix(_ key: DoseKey) -> String {
            "\(key.medicationID.uuidString).\(Int(key.scheduled.timeIntervalSince1970))"
        }
    }

    private enum UserInfoKey {
        static let medicationID = "medicationID"
        static let scheduled = "scheduled"
    }

    /// Call once at launch, before the app finishes launching, so actions
    /// tapped while the app wasn't running are delivered.
    func configure() {
        center.delegate = self
        let take = UNNotificationAction(identifier: ID.takeAction, title: "Mark as Taken", options: [])
        let snooze = UNNotificationAction(
            identifier: ID.snoozeAction,
            title: "Remind Me in \(Self.snoozeMinutes) Minutes",
            options: []
        )
        let category = UNNotificationCategory(identifier: ID.category, actions: [take, snooze], intentIdentifiers: [], options: [])
        center.setNotificationCategories([category])
    }

    var canSchedule: Bool {
        switch authorization {
        case .authorized, .provisional, .ephemeral: return true
        case .denied, .notDetermined: return false
        @unknown default: return false
        }
    }

    func updateAuthorizationStatus() async {
        authorization = await center.notificationSettings().authorizationStatus
    }

    @discardableResult
    func requestAuthorization() async -> Bool {
        let granted = (try? await center.requestAuthorization(options: [.alert, .sound])) ?? false
        await updateAuthorizationStatus()
        await refresh().value
        return granted
    }

    /// Rebuilds pending reminders from the current data.
    ///
    /// Refreshes run one after another so an older snapshot can never
    /// overwrite a newer one.
    @discardableResult
    func refresh() -> Task<Void, Never> {
        let previous = latestRefresh
        let task = Task {
            await previous?.value
            await rebuild()
        }
        latestRefresh = task
        return task
    }

    /// Clears reminders for a dose that was just logged.
    func doseResolved(_ key: DoseKey) {
        center.removePendingNotificationRequests(withIdentifiers: [ID.snooze(key)])
        center.removeDeliveredNotifications(withIdentifiers: [ID.dose(key), ID.snooze(key)])
    }

    /// Clears every reminder for a medication that is being deleted.
    func removeAll(for medicationID: UUID) {
        let marker = medicationID.uuidString
        Task {
            let pending = await center.pendingNotificationRequests().map(\.identifier).filter { $0.contains(marker) }
            center.removePendingNotificationRequests(withIdentifiers: pending)
            let delivered = await center.deliveredNotifications().map(\.request.identifier).filter { $0.contains(marker) }
            center.removeDeliveredNotifications(withIdentifiers: delivered)
        }
    }

    private func rebuild() async {
        await updateAuthorizationStatus()

        let pending = await center.pendingNotificationRequests()
        let stale = pending.map(\.identifier).filter { $0.hasPrefix(ID.dosePrefix) }
        center.removePendingNotificationRequests(withIdentifiers: stale)

        guard canSchedule else { return }

        let context = Persistence.container.mainContext
        let medications = ((try? context.fetch(FetchDescriptor<Medication>())) ?? []).filter { !$0.isArchived }
        let byID = Dictionary(medications.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let calendar = Calendar.current
        let plan = ReminderPlanner.upcoming(
            for: medications.map(\.scheduled),
            excluding: Set(medications.loggedStatuses.keys),
            after: .now,
            calendar: calendar
        )

        for key in plan {
            guard let medication = byID[key.medicationID] else { continue }
            let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: key.scheduled)
            let request = UNNotificationRequest(
                identifier: ID.dose(key),
                content: content(for: medication, key: key),
                trigger: UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
            )
            try? await center.add(request)
        }
    }

    private func content(for medication: Medication, key: DoseKey) -> UNNotificationContent {
        let content = UNMutableNotificationContent()
        if UserDefaults.standard.bool(forKey: Self.hideNamesKey) {
            content.title = "Medication Reminder"
            content.body = "It's time for a scheduled dose."
        } else {
            content.title = medication.name
            content.body = medication.dosage.isEmpty
                ? "It's time for your dose."
                : "It's time to take \(medication.dosage)."
        }
        content.sound = .default
        content.categoryIdentifier = ID.category
        content.threadIdentifier = medication.id.uuidString
        content.userInfo = [
            UserInfoKey.medicationID: key.medicationID.uuidString,
            UserInfoKey.scheduled: key.scheduled.timeIntervalSince1970,
        ]
        return content
    }

    private func handle(action: String, key: DoseKey) async {
        let context = Persistence.container.mainContext
        let id = key.medicationID
        let descriptor = FetchDescriptor<Medication>(predicate: #Predicate<Medication> { $0.id == id })
        guard let medication = try? context.fetch(descriptor).first else { return }

        switch action {
        case ID.takeAction:
            DoseActions.log(.taken, for: medication, at: key.scheduled, in: context)
            // Finish rescheduling before iOS suspends the app again.
            await latestRefresh?.value
        case ID.snoozeAction:
            guard medication.log(for: key.scheduled) == nil else { return }
            let request = UNNotificationRequest(
                identifier: ID.snooze(key),
                content: content(for: medication, key: key),
                trigger: UNTimeIntervalNotificationTrigger(timeInterval: TimeInterval(Self.snoozeMinutes * 60), repeats: false)
            )
            try? await center.add(request)
        default:
            break
        }
    }
}

extension NotificationManager: UNUserNotificationCenterDelegate {
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let action = response.actionIdentifier
        let info = response.notification.request.content.userInfo
        guard let idString = info[UserInfoKey.medicationID] as? String,
              let id = UUID(uuidString: idString),
              let interval = (info[UserInfoKey.scheduled] as? NSNumber)?.doubleValue
        else { return }
        await handle(action: action, key: DoseKey(medicationID: id, scheduled: Date(timeIntervalSince1970: interval)))
    }
}
