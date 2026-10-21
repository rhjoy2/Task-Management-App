import SwiftUI

struct RootView: View {
    @EnvironmentObject private var notifications: NotificationManager
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("hasCompletedOnboarding") private var hasCompletedOnboarding = false

    var body: some View {
        TabView {
            TodayView()
                .tabItem { Label("Today", systemImage: "checklist") }
            MedicationsView()
                .tabItem { Label("Medications", systemImage: "pills") }
            HistoryView()
                .tabItem { Label("History", systemImage: "chart.bar.xaxis") }
        }
        .fullScreenCover(isPresented: Binding(
            get: { !hasCompletedOnboarding },
            set: { hasCompletedOnboarding = !$0 }
        )) {
            OnboardingView { hasCompletedOnboarding = true }
                .environmentObject(notifications)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            if phase == .active { notifications.refresh() }
        }
    }
}

struct OnboardingView: View {
    @EnvironmentObject private var notifications: NotificationManager
    let onFinish: () -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                Image(systemName: "pills.circle.fill")
                    .font(.system(size: 80))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                    .padding(.top, 40)
                VStack(spacing: 8) {
                    Text("Welcome to DoseDay")
                        .font(.largeTitle.bold())
                    Text("Never wonder “did I take it?” again.")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)

                VStack(alignment: .leading, spacing: 20) {
                    feature("bell.badge.fill", "Gentle reminders", "Get a reminder at each dose time. Mark it taken right from the notification.")
                    feature("checkmark.circle.fill", "A clear daily checklist", "See what's done and what's left at a glance.")
                    feature("chart.bar.fill", "History to share", "Track your progress and share a summary with your doctor or pharmacist.")
                    feature("lock.fill", "Private by design", "Everything stays on this iPhone. No account, no ads, no tracking.")
                }
            }
            .padding(24)
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 12) {
                Button {
                    Task {
                        await notifications.requestAuthorization()
                        onFinish()
                    }
                } label: {
                    Text("Turn On Reminders")
                        .font(.headline)
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)

                Button("Not Now", action: onFinish)

                Text("DoseDay helps you keep track. It doesn't give medical advice; always follow your prescriber's instructions.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            .padding(24)
            .background(.bar)
        }
    }

    private func feature(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(.tint)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}
