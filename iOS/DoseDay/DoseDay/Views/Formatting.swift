import Foundation

enum TimeOfDay {
    /// Today's date at the given minutes after midnight, for use with `DatePicker`.
    static func date(minutes: Int, calendar: Calendar = .current) -> Date {
        var components = calendar.dateComponents([.year, .month, .day], from: .now)
        components.hour = minutes / 60
        components.minute = minutes % 60
        return calendar.date(from: components) ?? .now
    }

    static func minutes(from date: Date, calendar: Calendar = .current) -> Int {
        let components = calendar.dateComponents([.hour, .minute], from: date)
        return (components.hour ?? 0) * 60 + (components.minute ?? 0)
    }

    static func string(minutes: Int) -> String {
        date(minutes: minutes).formatted(date: .omitted, time: .shortened)
    }

    enum Period: Int, CaseIterable, Identifiable {
        case morning, afternoon, evening, night

        var id: Int { rawValue }

        init(minutes: Int) {
            switch minutes {
            case 4 * 60..<12 * 60: self = .morning
            case 12 * 60..<17 * 60: self = .afternoon
            case 17 * 60..<21 * 60: self = .evening
            default: self = .night
            }
        }

        var title: String {
            switch self {
            case .morning: return "Morning"
            case .afternoon: return "Afternoon"
            case .evening: return "Evening"
            case .night: return "Night"
            }
        }
    }
}

enum WeekdayText {
    /// Weekday numbers (1 = Sunday) in the order the user's calendar starts the week.
    static func ordered(calendar: Calendar = .current) -> [Int] {
        (0..<7).map { (calendar.firstWeekday - 1 + $0) % 7 + 1 }
    }

    static func short(_ weekday: Int, calendar: Calendar = .current) -> String {
        calendar.shortWeekdaySymbols[weekday - 1]
    }

    static func veryShort(_ weekday: Int, calendar: Calendar = .current) -> String {
        calendar.veryShortWeekdaySymbols[weekday - 1]
    }
}

extension Medication {
    var scheduleSummary: String {
        let schedule = self.schedule
        let days: String
        if schedule.isEveryDay {
            days = "Every day"
        } else {
            days = WeekdayText.ordered().filter(schedule.weekdays.contains).map { WeekdayText.short($0) }.joined(separator: ", ")
        }
        let times = schedule.times.map(TimeOfDay.string(minutes:)).joined(separator: ", ")
        return "\(days) · \(times)"
    }

    var supplySummary: String? {
        guard tracksSupply else { return nil }
        let left = "\(supplyRemaining) left"
        guard let days = daysOfSupply else { return left }
        return days == 1 ? "\(left) · about 1 day" : "\(left) · about \(days) days"
    }
}
