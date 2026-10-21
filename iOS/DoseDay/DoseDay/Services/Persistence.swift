import Foundation
import SwiftData

@MainActor
enum Persistence {
    /// The app's single on-device store. Shared with the notification handler so
    /// "Mark as Taken" from a reminder writes to the same data the UI shows.
    static let container: ModelContainer = {
        do {
            return try ModelContainer(for: Medication.self, DoseLog.self)
        } catch {
            fatalError("DoseDay could not open its database: \(error)")
        }
    }()
}

@MainActor
enum DoseActions {
    static func log(_ status: DoseStatus, for medication: Medication, at scheduled: Date, in context: ModelContext, now: Date = .now) {
        let previous = medication.log(for: scheduled)?.status
        if let existing = medication.log(for: scheduled) {
            existing.status = status
            existing.loggedAt = now
        } else {
            let log = DoseLog(scheduledDate: scheduled, status: status, loggedAt: now)
            context.insert(log)
            log.medication = medication
        }
        updateSupply(of: medication, from: previous, to: status)
        finish(DoseKey(medicationID: medication.id, scheduled: scheduled), in: context)
    }

    static func clear(for medication: Medication, at scheduled: Date, in context: ModelContext) {
        guard let existing = medication.log(for: scheduled) else { return }
        updateSupply(of: medication, from: existing.status, to: nil)
        context.delete(existing)
        finish(DoseKey(medicationID: medication.id, scheduled: scheduled), in: context)
    }

    static func delete(_ medication: Medication, in context: ModelContext) {
        NotificationManager.shared.removeAll(for: medication.id)
        context.delete(medication)
        save(context)
        NotificationManager.shared.refresh()
    }

    static func save(_ context: ModelContext) {
        do {
            try context.save()
        } catch {
            assertionFailure("Save failed: \(error)")
        }
    }

    private static func updateSupply(of medication: Medication, from old: DoseStatus?, to new: DoseStatus?) {
        guard medication.tracksSupply else { return }
        medication.supplyRemaining = SupplyEstimator.adjust(
            units: medication.supplyRemaining,
            unitsPerDose: medication.unitsPerDose,
            from: old,
            to: new
        )
    }

    private static func finish(_ key: DoseKey, in context: ModelContext) {
        save(context)
        NotificationManager.shared.doseResolved(key)
        NotificationManager.shared.refresh()
    }
}
