import Charts
import SwiftData
import SwiftUI

struct HistoryView: View {
    @Query(sort: \Medication.name) private var medications: [Medication]
    @State private var period = Period.week

    enum Period: Int, CaseIterable, Identifiable {
        case week = 7
        case month = 30
        case quarter = 90

        var id: Int { rawValue }
        var title: String {
            switch self {
            case .week: return "7 Days"
            case .month: return "30 Days"
            case .quarter: return "90 Days"
            }
        }
    }

    var body: some View {
        NavigationStack {
            let report = AdherenceReport(medications: medications, days: period.rawValue, now: .now, calendar: .current)
            List {
                Section {
                    Picker("Period", selection: $period) {
                        ForEach(Period.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                Section {
                    OverallSummary(stats: report.total, streak: report.streak)
                }

                Section("Daily") {
                    DailyChart(days: report.daily, period: period)
                        .frame(height: 180)
                        .padding(.vertical, 8)
                }

                if !report.medications.isEmpty {
                    Section("By Medication") {
                        ForEach(report.medications, id: \.medication.id) { entry in
                            MedicationAdherenceRow(medication: entry.medication, stats: entry.stats)
                        }
                    }
                }
            }
            .overlay {
                if medications.isEmpty {
                    ContentUnavailableView(
                        "No History Yet",
                        systemImage: "chart.bar.xaxis",
                        description: Text("Your progress will appear here once you start logging doses.")
                    )
                }
            }
            .navigationTitle("History")
            .toolbar {
                if !medications.isEmpty {
                    ToolbarItem(placement: .primaryAction) {
                        ShareLink(item: report.text, subject: Text("Medication history")) {
                            Label("Share Report", systemImage: "square.and.arrow.up")
                        }
                    }
                }
            }
        }
    }
}

/// Everything the History screen and the shared report show.
struct AdherenceReport {
    struct Entry {
        let medication: Medication
        let stats: AdherenceStats
    }

    let daily: [DayAdherence]
    let total: AdherenceStats
    let streak: Int
    let medications: [Entry]
    let text: String

    init(medications all: [Medication], days: Int, now: Date, calendar: Calendar) {
        let scheduled = all.map(\.scheduled)
        let logs = all.loggedStatuses
        let daily = AdherenceCalculator.daily(scheduled, logs: logs, days: days, now: now, calendar: calendar)
        let total = AdherenceCalculator.total(daily)
        // The streak looks further back than the selected period.
        let streak = AdherenceCalculator.currentStreak(
            AdherenceCalculator.daily(scheduled, logs: logs, days: 365, now: now, calendar: calendar)
        )

        let start = daily.first?.day ?? calendar.startOfDay(for: now)
        let end = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now)) ?? now
        let perMedication = AdherenceCalculator.perMedication(scheduled, logs: logs, from: start, to: end, now: now, calendar: calendar)
        let entries = all.compactMap { medication -> Entry? in
            guard let stats = perMedication[medication.id], stats.resolved > 0 else { return nil }
            return Entry(medication: medication, stats: stats)
        }

        var lines = ["DoseDay medication history"]
        let range = start.formatted(date: .abbreviated, time: .omitted) + " – " + now.formatted(date: .abbreviated, time: .omitted)
        lines.append("Period: \(range)")
        lines.append("Overall: " + Self.describe(total))
        for entry in entries {
            let medication = entry.medication
            let dosage = medication.dosage.isEmpty ? "" : " \(medication.dosage)"
            lines.append("")
            lines.append("\(medication.name)\(dosage)\(medication.isArchived ? " (stopped)" : "")")
            lines.append("  Schedule: \(medication.scheduleSummary)")
            lines.append("  " + Self.describe(entry.stats))
        }
        lines.append("")
        lines.append("Self-reported with the DoseDay app.")

        self.daily = daily
        self.total = total
        self.streak = streak
        self.medications = entries
        self.text = lines.joined(separator: "\n")
    }

    private static func describe(_ stats: AdherenceStats) -> String {
        guard let rate = stats.rate else { return "no doses due yet" }
        let percent = rate.formatted(.percent.precision(.fractionLength(0)))
        return "\(percent) taken (\(stats.taken) taken, \(stats.skipped) skipped, \(stats.missed) not logged)"
    }
}

private struct OverallSummary: View {
    let stats: AdherenceStats
    let streak: Int

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                if let rate = stats.rate {
                    Text(rate, format: .percent.precision(.fractionLength(0)))
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    Text("of doses taken")
                        .foregroundStyle(.secondary)
                } else {
                    Text("No doses due yet")
                        .font(.title2.bold())
                }
            }
            .accessibilityElement(children: .combine)

            HStack {
                stat("Taken", stats.taken, .green)
                stat("Skipped", stats.skipped, .orange)
                stat("Not logged", stats.missed, .red)
                stat(streak == 1 ? "Day streak" : "Days streak", streak, .accentColor)
            }
        }
        .padding(.vertical, 6)
    }

    private func stat(_ title: String, _ value: Int, _ color: Color) -> some View {
        VStack(spacing: 2) {
            Text(value, format: .number)
                .font(.title3.bold())
                .foregroundStyle(color)
                .monospacedDigit()
            Text(title)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct DailyChart: View {
    let days: [DayAdherence]
    let period: HistoryView.Period

    /// Label every day for a week, then thin the labels out for longer periods.
    private var axisDates: [Date] {
        let step: Int
        switch period {
        case .week: step = 1
        case .month: step = 7
        case .quarter: step = 21
        }
        let dates = days.map(\.day)
        return Array(stride(from: dates.count - 1, through: 0, by: -step).map { dates[$0] }.reversed())
    }

    private var axisFormat: Date.FormatStyle {
        period == .week ? .dateTime.weekday(.narrow) : .dateTime.month(.abbreviated).day()
    }

    var body: some View {
        Chart(days) { day in
            if let rate = day.stats.rate {
                BarMark(
                    x: .value("Day", day.day, unit: .day),
                    y: .value("Taken", rate)
                )
                .foregroundStyle(rate >= 0.8 ? Color.green.gradient : Color.orange.gradient)
                .cornerRadius(3)
            }
        }
        .chartYScale(domain: 0...1)
        .chartYAxis {
            AxisMarks(values: [0, 0.5, 1]) { value in
                AxisGridLine()
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(number, format: .percent)
                    }
                }
            }
        }
        .chartXAxis {
            AxisMarks(values: axisDates) { _ in
                AxisValueLabel(format: axisFormat, centered: true)
            }
        }
        .accessibilityLabel("Share of doses taken each day")
    }
}

private struct MedicationAdherenceRow: View {
    let medication: Medication
    let stats: AdherenceStats

    var body: some View {
        HStack(spacing: 14) {
            MedIcon(symbol: medication.symbol, color: medication.color, size: 34)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(medication.name).font(.subheadline.weight(.semibold))
                    Spacer()
                    if let rate = stats.rate {
                        Text(rate, format: .percent.precision(.fractionLength(0)))
                            .font(.subheadline.weight(.semibold))
                            .monospacedDigit()
                    }
                }
                ProgressView(value: stats.rate ?? 0)
                    .tint(medication.color.color)
                Text("\(stats.taken) of \(stats.resolved) doses taken")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}
