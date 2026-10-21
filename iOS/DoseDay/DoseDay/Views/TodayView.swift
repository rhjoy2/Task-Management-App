import SwiftData
import SwiftUI

struct DoseItem: Identifiable {
    let medication: Medication
    let scheduled: Date
    let state: DoseState
    let loggedAt: Date?

    var id: String { "\(medication.id.uuidString)-\(scheduled.timeIntervalSince1970)" }
}

struct TodayView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var notifications: NotificationManager
    @Query(sort: \Medication.name) private var medications: [Medication]

    @State private var day = Calendar.current.startOfDay(for: .now)
    @State private var now = Date.now
    @State private var isAddingMedication = false
    @State private var takenFeedback = 0

    private var calendar: Calendar { .current }
    private var isToday: Bool { calendar.isDate(day, inSameDayAs: now) }
    private var isFuture: Bool { day > calendar.startOfDay(for: now) }

    private var items: [DoseItem] {
        guard let end = calendar.date(byAdding: .day, value: 1, to: day) else { return [] }
        let byID = Dictionary(medications.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let doses = AdherenceCalculator.evaluate(
            medications.map(\.scheduled),
            logs: medications.loggedStatuses,
            from: day,
            to: end,
            now: now,
            calendar: calendar
        )
        return doses
            .compactMap { dose -> DoseItem? in
                guard let medication = byID[dose.key.medicationID] else { return nil }
                return DoseItem(
                    medication: medication,
                    scheduled: dose.key.scheduled,
                    state: dose.state,
                    loggedAt: medication.log(for: dose.key.scheduled)?.loggedAt
                )
            }
            .sorted { ($0.scheduled, $0.medication.name) < ($1.scheduled, $1.medication.name) }
    }

    var body: some View {
        NavigationStack {
            let items = self.items
            List {
                if !medications.isEmpty {
                    Section {
                        DaySummary(items: items, isToday: isToday, isFuture: isFuture)
                    }
                }

                if isToday {
                    if !medications.isEmpty && !notifications.canSchedule {
                        Section {
                            ReminderStatusBanner()
                        }
                    }

                    let refills = medications.filter(\.needsRefill)
                    if !refills.isEmpty {
                        Section {
                            ForEach(refills) { RefillRow(medication: $0) }
                        }
                    }
                }

                ForEach(TimeOfDay.Period.allCases) { period in
                    let periodItems = items.filter { TimeOfDay.Period(minutes: TimeOfDay.minutes(from: $0.scheduled)) == period }
                    if !periodItems.isEmpty {
                        Section(period.title) {
                            ForEach(periodItems) { item in
                                DoseRow(item: item, canLog: !isFuture) { status in
                                    record(status, for: item)
                                }
                            }
                        }
                    }
                }
            }
            .overlay {
                if medications.isEmpty {
                    ContentUnavailableView {
                        Label("No Medications Yet", systemImage: "pills")
                    } description: {
                        Text("Add a medication to get reminders and a daily checklist.")
                    } actions: {
                        Button("Add Medication") { isAddingMedication = true }
                            .buttonStyle(.borderedProminent)
                    }
                } else if items.isEmpty {
                    ContentUnavailableView(
                        "Nothing Scheduled",
                        systemImage: "calendar",
                        description: Text("No doses are scheduled for this day.")
                    )
                }
            }
            .navigationTitle(title)
            .toolbar { dayNavigation }
            .sheet(isPresented: $isAddingMedication) {
                MedicationEditor(medication: nil)
            }
            .sensoryFeedback(.success, trigger: takenFeedback)
            .task { await keepClockCurrent() }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { tick() }
            }
        }
    }

    private var title: String {
        if isToday { return "Today" }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: now), calendar.isDate(day, inSameDayAs: yesterday) {
            return "Yesterday"
        }
        if let tomorrow = calendar.date(byAdding: .day, value: 1, to: now), calendar.isDate(day, inSameDayAs: tomorrow) {
            return "Tomorrow"
        }
        return day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    @ToolbarContentBuilder
    private var dayNavigation: some ToolbarContent {
        ToolbarItemGroup(placement: .topBarTrailing) {
            Button {
                move(by: -1)
            } label: {
                Label("Previous Day", systemImage: "chevron.left")
            }
            if !isToday {
                Button("Today") {
                    day = calendar.startOfDay(for: now)
                }
            }
            Button {
                move(by: 1)
            } label: {
                Label("Next Day", systemImage: "chevron.right")
            }
        }
    }

    private func move(by days: Int) {
        if let next = calendar.date(byAdding: .day, value: days, to: day) {
            day = calendar.startOfDay(for: next)
        }
    }

    private func record(_ status: DoseStatus?, for item: DoseItem) {
        if let status {
            DoseActions.log(status, for: item.medication, at: item.scheduled, in: context)
            if status == .taken { takenFeedback += 1 }
        } else {
            DoseActions.clear(for: item.medication, at: item.scheduled, in: context)
        }
    }

    /// Keeps "overdue" and "missed" labels accurate, and follows the date
    /// across midnight when the person is looking at today.
    private func keepClockCurrent() async {
        while !Task.isCancelled {
            tick()
            try? await Task.sleep(for: .seconds(30))
        }
    }

    private func tick() {
        let wasToday = isToday
        now = .now
        if wasToday { day = calendar.startOfDay(for: now) }
    }
}

private struct DaySummary: View {
    let items: [DoseItem]
    let isToday: Bool
    let isFuture: Bool

    private var taken: Int { items.filter { $0.state == .taken }.count }
    private var progress: Double { items.isEmpty ? 0 : Double(taken) / Double(items.count) }

    var body: some View {
        HStack(spacing: 20) {
            ZStack {
                ProgressRing(progress: progress)
                Text(progress, format: .percent.precision(.fractionLength(0)))
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
            }
            .frame(width: 72, height: 72)
            .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 4) {
                Text("\(taken) of \(items.count) doses taken")
                    .font(.headline)
                Text(detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    private var detail: String {
        if items.isEmpty { return "Nothing scheduled." }
        if isFuture { return "Scheduled for this day." }
        if taken == items.count { return isToday ? "All done for today. Nice work!" : "Every dose was taken." }
        if isToday, let next = items.first(where: { $0.state == .due || $0.state == .upcoming }) {
            let time = next.scheduled.formatted(date: .omitted, time: .shortened)
            return next.state == .due ? "\(next.medication.name) was due at \(time)." : "Next: \(next.medication.name) at \(time)."
        }
        let missed = items.filter { $0.state == .missed }.count
        return missed > 0 ? "\(missed) not logged. You can still record them." : "Everything is logged."
    }
}

struct DoseRow: View {
    let item: DoseItem
    let canLog: Bool
    /// nil clears the log.
    let onLog: (DoseStatus?) -> Void

    private var medication: Medication { item.medication }
    private var time: String { item.scheduled.formatted(date: .omitted, time: .shortened) }

    var body: some View {
        HStack(spacing: 14) {
            MedIcon(symbol: medication.symbol, color: medication.color)
            VStack(alignment: .leading, spacing: 3) {
                Text(medication.name)
                    .font(.body.weight(.semibold))
                    .strikethrough(item.state == .skipped)
                if !medication.dosage.isEmpty {
                    Text(medication.dosage)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                status
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 8)
            if canLog { takeButton }
        }
        .padding(.vertical, 4)
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            if canLog { secondaryActions }
        }
        .contextMenu {
            if canLog {
                if item.state != .taken {
                    Button { onLog(.taken) } label: { Label("Mark as Taken", systemImage: "checkmark.circle") }
                }
                secondaryActions
            }
        }
    }

    @ViewBuilder
    private var secondaryActions: some View {
        if item.state != .skipped {
            Button { onLog(.skipped) } label: { Label("Skip", systemImage: "forward.end") }
                .tint(.orange)
        }
        if item.state == .taken || item.state == .skipped {
            Button { onLog(nil) } label: { Label("Undo", systemImage: "arrow.uturn.backward") }
                .tint(.gray)
        }
    }

    private var takeButton: some View {
        let isTaken = item.state == .taken
        return Button {
            onLog(isTaken ? nil : .taken)
        } label: {
            Image(systemName: isTaken ? "checkmark.circle.fill" : "circle")
                .font(.system(size: 30))
                .foregroundStyle(isTaken ? Color.green : Color.secondary)
                .contentTransition(.symbolEffect(.replace))
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(isTaken ? "Undo taken for \(medication.name)" : "Mark \(medication.name) as taken")
    }

    private var takenText: String {
        guard let loggedAt = item.loggedAt else { return "Taken" }
        return "Taken at \(loggedAt.formatted(date: .omitted, time: .shortened))"
    }

    @ViewBuilder
    private var status: some View {
        switch item.state {
        case .taken:
            Label(takenText, systemImage: "checkmark")
                .font(.caption.weight(.medium))
                .foregroundStyle(.green)
        case .skipped:
            Label("Skipped · \(time)", systemImage: "forward.end")
                .font(.caption.weight(.medium))
                .foregroundStyle(.orange)
        case .due:
            Label("Overdue · \(time)", systemImage: "exclamationmark.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(.orange)
        case .missed:
            Label("Not logged · \(time)", systemImage: "xmark.circle")
                .font(.caption.weight(.medium))
                .foregroundStyle(.red)
        case .upcoming:
            Label(time, systemImage: "clock")
                .font(.caption.weight(.medium))
                .foregroundStyle(.secondary)
        }
    }
}
