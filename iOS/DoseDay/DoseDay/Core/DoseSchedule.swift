import Foundation

/// When a medication should be taken.
///
/// This is a plain value type (no SwiftData, no UIKit) so the scheduling rules
/// can be unit-tested in isolation, including on Linux via `swift test`.
struct DoseSchedule: Equatable {
    /// Minutes after midnight, sorted and unique. 8:30 AM is 510.
    private(set) var times: [Int]
    /// Calendar weekdays (1 = Sunday … 7 = Saturday). Empty means every day.
    private(set) var weekdays: Set<Int>
    /// First moment the schedule applies. Only the day matters.
    var startDate: Date
    /// When the medication was stopped. Doses at or after this instant don't exist.
    var endDate: Date?

    init(times: [Int], weekdays: Set<Int> = [], startDate: Date, endDate: Date? = nil) {
        self.times = Array(Set(times.filter { (0..<DoseSchedule.minutesPerDay).contains($0) })).sorted()
        self.weekdays = weekdays.filter { (1...7).contains($0) }
        self.startDate = startDate
        self.endDate = endDate
    }

    static let minutesPerDay = 24 * 60

    var isEveryDay: Bool { weekdays.isEmpty || weekdays.count == 7 }

    /// Average number of doses per day; used to estimate how long a supply lasts.
    var dosesPerDay: Double {
        Double(times.count) * (isEveryDay ? 1 : Double(weekdays.count) / 7)
    }

    func isActive(on day: Date, calendar: Calendar) -> Bool {
        let day = calendar.startOfDay(for: day)
        guard day >= calendar.startOfDay(for: startDate) else { return false }
        if let endDate, day >= endDate { return false }
        return isEveryDay || weekdays.contains(calendar.component(.weekday, from: day))
    }

    /// The doses scheduled on the calendar day containing `day`, in order.
    func doses(on day: Date, calendar: Calendar) -> [Date] {
        guard isActive(on: day, calendar: calendar) else { return [] }
        let ymd = calendar.dateComponents([.year, .month, .day], from: day)
        return times.compactMap { minutes in
            var components = ymd
            components.hour = minutes / 60
            components.minute = minutes % 60
            // Building from components (rather than adding an interval to
            // midnight) keeps wall-clock times correct across DST changes.
            guard let date = calendar.date(from: components) else { return nil }
            if let endDate, date >= endDate { return nil }
            return date
        }
    }

    /// Every dose with `start <= dose < end`, in chronological order.
    func doses(from start: Date, to end: Date, calendar: Calendar) -> [Date] {
        guard start < end else { return [] }
        var result: [Date] = []
        var day = calendar.startOfDay(for: start)
        while day < end {
            result += doses(on: day, calendar: calendar).filter { $0 >= start && $0 < end }
            guard let next = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = next
        }
        return result
    }
}

/// A medication as seen by the scheduling and statistics code.
struct ScheduledMedication: Equatable {
    var id: UUID
    var schedule: DoseSchedule
}

/// Identifies one dose of one medication.
struct DoseKey: Hashable {
    var medicationID: UUID
    var scheduled: Date
}
