import SwiftData
import SwiftUI

struct MedicationsView: View {
    @Environment(\.modelContext) private var context
    @Query(sort: \Medication.name) private var medications: [Medication]

    @State private var editing: Medication?
    @State private var isAdding = false
    @State private var isShowingSettings = false
    @State private var pendingDelete: Medication?

    private var active: [Medication] { medications.filter { !$0.isArchived } }
    private var archived: [Medication] { medications.filter(\.isArchived) }

    var body: some View {
        NavigationStack {
            List {
                if !active.isEmpty {
                    Section("Active") {
                        ForEach(active) { row(for: $0) }
                    }
                }
                if !archived.isEmpty {
                    Section("Archived") {
                        ForEach(archived) { row(for: $0) }
                    }
                }
            }
            .overlay {
                if medications.isEmpty {
                    ContentUnavailableView {
                        Label("No Medications", systemImage: "pills")
                    } description: {
                        Text("Add the medications, vitamins, or supplements you take.")
                    } actions: {
                        Button("Add Medication") { isAdding = true }
                            .buttonStyle(.borderedProminent)
                    }
                }
            }
            .navigationTitle("Medications")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        isShowingSettings = true
                    } label: {
                        Label("Settings", systemImage: "gearshape")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isAdding = true
                    } label: {
                        Label("Add Medication", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $isAdding) {
                MedicationEditor(medication: nil)
            }
            .sheet(item: $editing) { medication in
                MedicationEditor(medication: medication)
            }
            .sheet(isPresented: $isShowingSettings) {
                SettingsView()
                    .environmentObject(NotificationManager.shared)
            }
            .confirmationDialog(
                "Delete \(pendingDelete?.name ?? "medication")?",
                isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
                titleVisibility: .visible,
                presenting: pendingDelete
            ) { medication in
                Button("Delete Medication and History", role: .destructive) {
                    DoseActions.delete(medication, in: context)
                    pendingDelete = nil
                }
            } message: { _ in
                Text("Its reminders and all of its history will be removed. To keep the history, archive it instead.")
            }
        }
    }

    private func row(for medication: Medication) -> some View {
        Button {
            editing = medication
        } label: {
            HStack(spacing: 14) {
                MedIcon(symbol: medication.symbol, color: medication.color)
                VStack(alignment: .leading, spacing: 3) {
                    Text(medication.name)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(.primary)
                    if !medication.dosage.isEmpty {
                        Text(medication.dosage)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Text(medication.scheduleSummary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let supply = medication.supplySummary {
                        Label(supply, systemImage: medication.needsRefill ? "exclamationmark.triangle.fill" : "shippingbox")
                            .font(.caption)
                            .foregroundStyle(medication.needsRefill ? Color.orange : Color.secondary)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 4)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Edit medication")
        .swipeActions {
            Button(role: .destructive) {
                pendingDelete = medication
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }
}

struct SettingsView: View {
    @EnvironmentObject private var notifications: NotificationManager
    @Environment(\.dismiss) private var dismiss
    @AppStorage(NotificationManager.hideNamesKey) private var hideNames = false

    private var version: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(short) (\(build))"
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Notifications", value: notifications.canSchedule ? "On" : "Off")
                    if !notifications.canSchedule {
                        ReminderStatusBanner()
                    }
                    Toggle("Hide Names on Lock Screen", isOn: $hideNames)
                } header: {
                    Text("Reminders")
                } footer: {
                    Text("When on, reminders say “Medication Reminder” instead of the medication's name.")
                }

                Section("Privacy") {
                    Label("Your data is stored only on this iPhone. DoseDay has no account, no servers, no ads, and no analytics.", systemImage: "lock.shield")
                        .font(.subheadline)
                }

                Section {
                    Text("DoseDay is a tracking aid, not medical advice. Always follow the instructions from your doctor or pharmacist. In an emergency, call your local emergency number.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                } header: {
                    Text("Important")
                }

                Section {
                    LabeledContent("Version", value: version)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onChange(of: hideNames) { _, _ in
                notifications.refresh()
            }
            .task { await notifications.updateAuthorizationStatus() }
        }
    }
}
