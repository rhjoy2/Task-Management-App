import SwiftData
import SwiftUI

/// Editable copy of a medication. Changes only reach the store on Save.
struct MedicationDraft {
    struct DoseTime: Identifiable, Equatable {
        let id = UUID()
        var minutes: Int
    }

    var name = ""
    var dosage = ""
    var notes = ""
    var color: MedColor = .blue
    var symbol: MedSymbol = .pills
    var times = [DoseTime(minutes: 8 * 60)]
    var everyDay = true
    var weekdays = Set(1...7)
    var startDate = Date.now
    var isArchived = false
    var tracksSupply = false
    var supplyRemaining = 30
    var unitsPerDose = 1
    var refillWarningDays = 7

    init() {}

    init(_ medication: Medication) {
        name = medication.name
        dosage = medication.dosage
        notes = medication.notes
        color = medication.color
        symbol = medication.symbol
        times = medication.schedule.times.map { DoseTime(minutes: $0) }
        everyDay = medication.schedule.isEveryDay
        weekdays = everyDay ? Set(1...7) : medication.schedule.weekdays
        startDate = medication.startDate
        isArchived = medication.isArchived
        tracksSupply = medication.tracksSupply
        supplyRemaining = medication.supplyRemaining
        unitsPerDose = medication.unitsPerDose
        refillWarningDays = medication.refillWarningDays
    }

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var minutes: [Int] { Array(Set(times.map(\.minutes))).sorted() }
    var weekdayList: [Int] { everyDay || weekdays.count == 7 ? [] : weekdays.sorted() }

    var problem: String? {
        if trimmedName.isEmpty { return "Enter a name." }
        if times.isEmpty { return "Add at least one dose time." }
        if !everyDay && weekdays.isEmpty { return "Choose at least one day." }
        return nil
    }

    /// The next time to suggest when adding a dose time: four hours after the
    /// latest one, skipping times that are already in the list.
    var suggestedNextTime: Int {
        let existing = Set(times.map(\.minutes))
        var candidate = ((times.map(\.minutes).max() ?? 4 * 60) + 4 * 60) % DoseSchedule.minutesPerDay
        while existing.contains(candidate) {
            candidate = (candidate + 30) % DoseSchedule.minutesPerDay
        }
        return candidate
    }

    func apply(to medication: Medication, isNew: Bool, now: Date = .now, calendar: Calendar = .current) {
        let today = calendar.startOfDay(for: now)
        let scheduleChanged = medication.times != minutes || Set(medication.weekdays) != Set(weekdayList)
        let unarchived = medication.isArchived && !isArchived

        medication.name = trimmedName
        medication.dosage = dosage.trimmingCharacters(in: .whitespacesAndNewlines)
        medication.notes = notes.trimmingCharacters(in: .whitespacesAndNewlines)
        medication.colorName = color.rawValue
        medication.symbolName = symbol.rawValue
        medication.times = minutes
        medication.weekdays = weekdayList

        // Past days were tracked against the old schedule. Rather than
        // re-judge them against the new one, start the new schedule today;
        // logged doses from before stay in the history.
        if !isNew && (scheduleChanged || unarchived) && startDate < today {
            medication.startDate = today
        } else {
            medication.startDate = calendar.startOfDay(for: startDate)
        }

        if isArchived && medication.archivedAt == nil {
            medication.archivedAt = now
        } else if !isArchived {
            medication.archivedAt = nil
        }

        medication.tracksSupply = tracksSupply
        medication.supplyRemaining = max(0, supplyRemaining)
        medication.unitsPerDose = max(1, unitsPerDose)
        medication.refillWarningDays = max(0, refillWarningDays)
    }
}

struct MedicationEditor: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    let medication: Medication?

    @State private var draft: MedicationDraft
    @State private var isConfirmingDelete = false
    @FocusState private var nameFocused: Bool

    init(medication: Medication?) {
        self.medication = medication
        _draft = State(initialValue: medication.map { MedicationDraft($0) } ?? MedicationDraft())
    }

    private var isNew: Bool { medication == nil }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Name, e.g. Metformin", text: $draft.name)
                        .textInputAutocapitalization(.words)
                        .focused($nameFocused)
                    TextField("Dose, e.g. 500 mg or 1 tablet", text: $draft.dosage)
                }

                appearanceSection
                scheduleSection
                supplySection

                Section("Notes") {
                    TextField("e.g. Take with food", text: $draft.notes, axis: .vertical)
                        .lineLimit(2...6)
                }

                if !isNew {
                    Section {
                        Toggle("Archived", isOn: $draft.isArchived)
                    } footer: {
                        Text("Archived medications stop sending reminders but keep their history.")
                    }

                    Section {
                        Button("Delete Medication", role: .destructive) {
                            isConfirmingDelete = true
                        }
                    }
                }
            }
            .navigationTitle(isNew ? "New Medication" : "Edit Medication")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .disabled(draft.problem != nil)
                }
            }
            .confirmationDialog(
                "Delete \(draft.trimmedName.isEmpty ? "this medication" : draft.trimmedName)?",
                isPresented: $isConfirmingDelete,
                titleVisibility: .visible
            ) {
                Button("Delete Medication and History", role: .destructive, action: delete)
            } message: {
                Text("Its reminders and all of its history will be removed. To keep the history, archive it instead.")
            }
            .onAppear {
                if isNew { nameFocused = true }
            }
        }
        .interactiveDismissDisabled(isNew ? !draft.trimmedName.isEmpty : false)
    }

    private var appearanceSection: some View {
        Section("Appearance") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(MedColor.allCases) { color in
                        Button {
                            draft.color = color
                        } label: {
                            Circle()
                                .fill(color.color.gradient)
                                .frame(width: 32, height: 32)
                                .overlay {
                                    if draft.color == color {
                                        Image(systemName: "checkmark")
                                            .font(.caption.bold())
                                            .foregroundStyle(.white)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(color.name)
                        .accessibilityAddTraits(draft.color == color ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
            }

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 12) {
                    ForEach(MedSymbol.allCases) { symbol in
                        Button {
                            draft.symbol = symbol
                        } label: {
                            MedIcon(symbol: symbol, color: draft.symbol == symbol ? draft.color : .indigo, size: 40)
                                .opacity(draft.symbol == symbol ? 1 : 0.35)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(symbol.name)
                        .accessibilityAddTraits(draft.symbol == symbol ? .isSelected : [])
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private var scheduleSection: some View {
        Section {
            ForEach($draft.times) { $time in
                DatePicker(
                    "Dose time",
                    selection: Binding(
                        get: { TimeOfDay.date(minutes: time.minutes) },
                        set: { $time.wrappedValue.minutes = TimeOfDay.minutes(from: $0) }
                    ),
                    displayedComponents: .hourAndMinute
                )
            }
            .onDelete { draft.times.remove(atOffsets: $0) }

            Button {
                draft.times.append(.init(minutes: draft.suggestedNextTime))
            } label: {
                Label("Add Time", systemImage: "plus.circle.fill")
            }

            Picker("Repeat", selection: $draft.everyDay) {
                Text("Every Day").tag(true)
                Text("Specific Days").tag(false)
            }

            if !draft.everyDay {
                HStack {
                    ForEach(WeekdayText.ordered(), id: \.self) { weekday in
                        let selected = draft.weekdays.contains(weekday)
                        Button {
                            if selected { draft.weekdays.remove(weekday) } else { draft.weekdays.insert(weekday) }
                        } label: {
                            Text(WeekdayText.veryShort(weekday))
                                .font(.subheadline.weight(.semibold))
                                .frame(maxWidth: .infinity, minHeight: 36)
                                .background(selected ? Color.accentColor : Color.secondary.opacity(0.15), in: Circle())
                                .foregroundStyle(selected ? Color.white : Color.primary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(Calendar.current.weekdaySymbols[weekday - 1])
                        .accessibilityAddTraits(selected ? .isSelected : [])
                    }
                }
            }

            DatePicker("Starts", selection: $draft.startDate, displayedComponents: .date)
        } header: {
            Text("Schedule")
        } footer: {
            if let problem = draft.problem, !draft.trimmedName.isEmpty {
                Text(problem).foregroundStyle(.red)
            } else if !isNew {
                Text("Schedule changes apply from today. Your past history is kept.")
            }
        }
    }

    private var supplySection: some View {
        Section {
            Toggle("Track Supply", isOn: $draft.tracksSupply.animation())
            if draft.tracksSupply {
                LabeledContent("Pills or doses left") {
                    TextField("Amount", value: $draft.supplyRemaining, format: .number)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 100)
                }
                Stepper("Per dose: \(draft.unitsPerDose)", value: $draft.unitsPerDose, in: 1...20)
                Stepper("Warn \(draft.refillWarningDays) days before running out", value: $draft.refillWarningDays, in: 0...60)
            }
        } header: {
            Text("Refills")
        } footer: {
            if draft.tracksSupply {
                Text("The count goes down each time you mark a dose as taken.")
            }
        }
    }

    private func save() {
        guard draft.problem == nil else { return }
        let target: Medication
        if let medication {
            target = medication
        } else {
            target = Medication(name: draft.trimmedName)
            context.insert(target)
        }
        draft.apply(to: target, isNew: isNew)
        DoseActions.save(context)
        NotificationManager.shared.refresh()
        dismiss()
    }

    private func delete() {
        guard let medication else { return }
        DoseActions.delete(medication, in: context)
        dismiss()
    }
}
