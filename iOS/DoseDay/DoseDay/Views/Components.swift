import SwiftUI
import UIKit

struct MedIcon: View {
    let symbol: MedSymbol
    let color: MedColor
    var size: CGFloat = 40

    var body: some View {
        Image(systemName: symbol.rawValue)
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(color.color.gradient, in: RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct ProgressRing: View {
    /// 0...1
    let progress: Double
    var lineWidth: CGFloat = 10

    var body: some View {
        ZStack {
            Circle().stroke(Color.accentColor.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: min(max(progress, 0), 1))
                .stroke(Color.accentColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.spring(duration: 0.5), value: progress)
        }
    }
}

/// Shown when reminders can't be delivered.
struct ReminderStatusBanner: View {
    @EnvironmentObject private var notifications: NotificationManager
    @Environment(\.openURL) private var openURL

    var body: some View {
        switch notifications.authorization {
        case .denied:
            banner(
                message: "Reminders are turned off for DoseDay in Settings.",
                buttonTitle: "Open Settings"
            ) {
                if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
            }
        case .notDetermined:
            banner(message: "Turn on reminders so you never miss a dose.", buttonTitle: "Turn On Reminders") {
                Task { await notifications.requestAuthorization() }
            }
        default:
            EmptyView()
        }
    }

    private func banner(message: String, buttonTitle: String, action: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(message, systemImage: "bell.slash.fill")
                .font(.subheadline)
            Button(buttonTitle, action: action)
                .buttonStyle(.bordered)
        }
        .padding(.vertical, 4)
    }
}

struct RefillRow: View {
    let medication: Medication

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(.orange)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Refill \(medication.name) soon")
                    .font(.subheadline.weight(.semibold))
                if let summary = medication.supplySummary {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }
}
