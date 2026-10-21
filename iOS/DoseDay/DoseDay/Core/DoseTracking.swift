import Foundation

/// What the person recorded for a dose.
enum DoseStatus: String, Codable, CaseIterable {
    case taken
    case skipped
}

/// The state of a dose at a given moment.
enum DoseState: Equatable {
    /// Not logged and its time hasn't come yet.
    case upcoming
    /// Not logged, its time has passed, but it's still the same day.
    case due
    case taken
    case skipped
    /// Not logged and the day it belonged to is over.
    case missed

    static func resolve(scheduled: Date, logged: DoseStatus?, now: Date, calendar: Calendar) -> DoseState {
        switch logged {
        case .taken: return .taken
        case .skipped: return .skipped
        case nil:
            if now < scheduled { return .upcoming }
            return calendar.isDate(scheduled, inSameDayAs: now) ? .due : .missed
        }
    }

    /// Whether this dose has an outcome that counts toward adherence.
    var isResolved: Bool {
        switch self {
        case .taken, .skipped, .missed: return true
        case .upcoming, .due: return false
        }
    }
}

struct AdherenceStats: Equatable {
    var taken = 0
    var skipped = 0
    var missed = 0

    var resolved: Int { taken + skipped + missed }

    /// Share of resolved doses that were taken, or nil when nothing is resolved yet.
    var rate: Double? {
        resolved == 0 ? nil : Double(taken) / Double(resolved)
    }

    /// A day counts toward a streak when something was resolved and all of it was taken.
    var isPerfect: Bool { resolved > 0 && taken == resolved }

    mutating func record(_ state: DoseState) {
        switch state {
        case .taken: taken += 1
        case .skipped: skipped += 1
        case .missed: missed += 1
        case .upcoming, .due: break
        }
    }

    static func + (lhs: AdherenceStats, rhs: AdherenceStats) -> AdherenceStats {
        AdherenceStats(taken: lhs.taken + rhs.taken, skipped: lhs.skipped + rhs.skipped, missed: lhs.missed + rhs.missed)
    }
}

struct EvaluatedDose: Equatable {
    var key: DoseKey
    var state: DoseState
}

struct DayAdherence: Identifiable, Equatable {
    var day: Date
    var stats: AdherenceStats
    var id: Date { day }
}

enum AdherenceCalculator {
    /// Every dose of `medications` with `start <= dose < end`, with its state.
    ///
    /// Logged doses whose time is no longer on the schedule (for example after
    /// the schedule was edited) are still included, so history is never lost.
    static func evaluate(
        _ medications: [ScheduledMedication],
        logs: [DoseKey: DoseStatus],
        from start: Date,
        to end: Date,
        now: Date,
        calendar: Calendar
    ) -> [EvaluatedDose] {
        var keys = Set<DoseKey>()
        for medication in medications {
            for date in medication.schedule.doses(from: start, to: end, calendar: calendar) {
                keys.insert(DoseKey(medicationID: medication.id, scheduled: date))
            }
        }
        let ids = Set(medications.map(\.id))
        for key in logs.keys where ids.contains(key.medicationID) && key.scheduled >= start && key.scheduled < end {
            keys.insert(key)
        }
        return keys
            .map { EvaluatedDose(key: $0, state: .resolve(scheduled: $0.scheduled, logged: logs[$0], now: now, calendar: calendar)) }
            .sorted { ($0.key.scheduled, $0.key.medicationID.uuidString) < ($1.key.scheduled, $1.key.medicationID.uuidString) }
    }

    /// One entry per day for the `days` days ending today, oldest first.
    static func daily(
        _ medications: [ScheduledMedication],
        logs: [DoseKey: DoseStatus],
        days: Int,
        now: Date,
        calendar: Calendar
    ) -> [DayAdherence] {
        guard days > 0 else { return [] }
        let today = calendar.startOfDay(for: now)
        let dayStarts = (0..<days).reversed().compactMap { calendar.date(byAdding: .day, value: -$0, to: today) }
        guard let first = dayStarts.first,
              let end = calendar.date(byAdding: .day, value: 1, to: today) else { return [] }

        var byDay = Dictionary(uniqueKeysWithValues: dayStarts.map { ($0, AdherenceStats()) })
        for dose in evaluate(medications, logs: logs, from: first, to: end, now: now, calendar: calendar) {
            byDay[calendar.startOfDay(for: dose.key.scheduled)]?.record(dose.state)
        }
        return dayStarts.map { DayAdherence(day: $0, stats: byDay[$0] ?? AdherenceStats()) }
    }

    static func total(_ days: [DayAdherence]) -> AdherenceStats {
        days.reduce(AdherenceStats()) { $0 + $1.stats }
    }

    static func perMedication(
        _ medications: [ScheduledMedication],
        logs: [DoseKey: DoseStatus],
        from start: Date,
        to end: Date,
        now: Date,
        calendar: Calendar
    ) -> [UUID: AdherenceStats] {
        var result: [UUID: AdherenceStats] = [:]
        for dose in evaluate(medications, logs: logs, from: start, to: end, now: now, calendar: calendar) {
            result[dose.key.medicationID, default: AdherenceStats()].record(dose.state)
        }
        return result
    }

    /// Consecutive perfect days, counting back from the most recent day.
    ///
    /// Days with nothing resolved (no doses scheduled, or today's doses not
    /// due yet) neither extend nor break the streak.
    static func currentStreak(_ days: [DayAdherence]) -> Int {
        var streak = 0
        for day in days.reversed() {
            if day.stats.resolved == 0 { continue }
            guard day.stats.isPerfect else { break }
            streak += 1
        }
        return streak
    }
}

enum ReminderPlanner {
    /// iOS keeps at most 64 pending local notifications per app. Leave room for snoozes.
    static let defaultLimit = 60

    /// The next unlogged doses to remind about, soonest first.
    static func upcoming(
        for medications: [ScheduledMedication],
        excluding logged: Set<DoseKey>,
        after now: Date,
        horizonDays: Int = 14,
        limit: Int = defaultLimit,
        calendar: Calendar
    ) -> [DoseKey] {
        guard limit > 0, let end = calendar.date(byAdding: .day, value: horizonDays, to: now) else { return [] }
        var keys: [DoseKey] = []
        for medication in medications {
            for date in medication.schedule.doses(from: now, to: end, calendar: calendar) where date > now {
                let key = DoseKey(medicationID: medication.id, scheduled: date)
                if !logged.contains(key) { keys.append(key) }
            }
        }
        keys.sort { ($0.scheduled, $0.medicationID.uuidString) < ($1.scheduled, $1.medicationID.uuidString) }
        return Array(keys.prefix(limit))
    }
}

enum SupplyEstimator {
    /// Whole days the remaining supply lasts, or nil if it can't be estimated.
    static func daysRemaining(units: Int, unitsPerDose: Int, dosesPerDay: Double) -> Int? {
        guard unitsPerDose > 0, dosesPerDay > 0 else { return nil }
        let perDay = Double(unitsPerDose) * dosesPerDay
        return Int((Double(max(units, 0)) / perDay).rounded(.down))
    }

    /// Units left after a dose's status changes from `old` to `new`.
    static func adjust(units: Int, unitsPerDose: Int, from old: DoseStatus?, to new: DoseStatus?) -> Int {
        let wasTaken = old == .taken
        let isTaken = new == .taken
        if wasTaken == isTaken { return units }
        return isTaken ? max(0, units - unitsPerDose) : units + unitsPerDose
    }
}
