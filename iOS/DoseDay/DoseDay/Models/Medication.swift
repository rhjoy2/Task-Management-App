import Foundation
import SwiftData

@Model
final class Medication {
    var id: UUID = UUID()
    var name: String = ""
    /// Free text such as "500 mg" or "2 puffs".
    var dosage: String = ""
    var notes: String = ""
    var colorName: String = MedColor.blue.rawValue
    var symbolName: String = MedSymbol.pills.rawValue

    /// Minutes after midnight for each daily dose.
    var times: [Int] = [8 * 60]
    /// Calendar weekdays (1 = Sunday … 7 = Saturday). Empty means every day.
    var weekdays: [Int] = []
    var startDate: Date = Date.now
    /// Set when the medication is archived. Nothing is scheduled after it.
    var archivedAt: Date?

    var tracksSupply: Bool = false
    var supplyRemaining: Int = 0
    var unitsPerDose: Int = 1
    /// Warn when the supply will run out within this many days.
    var refillWarningDays: Int = 7

    var createdAt: Date = Date.now

    @Relationship(deleteRule: .cascade, inverse: \DoseLog.medication)
    var logs: [DoseLog]? = []

    init(name: String, dosage: String = "", times: [Int] = [8 * 60], weekdays: [Int] = [], startDate: Date = .now) {
        self.id = UUID()
        self.name = name
        self.dosage = dosage
        self.times = times
        self.weekdays = weekdays
        self.startDate = startDate
        self.createdAt = .now
    }

    var isArchived: Bool { archivedAt != nil }

    var schedule: DoseSchedule {
        DoseSchedule(times: times, weekdays: Set(weekdays), startDate: startDate, endDate: archivedAt)
    }

    var scheduled: ScheduledMedication {
        ScheduledMedication(id: id, schedule: schedule)
    }

    var color: MedColor { MedColor(rawValue: colorName) ?? .blue }
    var symbol: MedSymbol { MedSymbol(rawValue: symbolName) ?? .pills }

    var loggedStatuses: [DoseKey: DoseStatus] {
        var result: [DoseKey: DoseStatus] = [:]
        for log in logs ?? [] {
            result[DoseKey(medicationID: id, scheduled: log.scheduledDate)] = log.status
        }
        return result
    }

    func log(for scheduled: Date) -> DoseLog? {
        (logs ?? []).first { $0.scheduledDate == scheduled }
    }

    /// Whole days of supply left, when supply is tracked.
    var daysOfSupply: Int? {
        guard tracksSupply else { return nil }
        return SupplyEstimator.daysRemaining(units: supplyRemaining, unitsPerDose: unitsPerDose, dosesPerDay: schedule.dosesPerDay)
    }

    var needsRefill: Bool {
        guard !isArchived, let days = daysOfSupply else { return false }
        return days <= refillWarningDays
    }
}

extension Array where Element == Medication {
    var loggedStatuses: [DoseKey: DoseStatus] {
        reduce(into: [:]) { result, medication in
            result.merge(medication.loggedStatuses) { current, _ in current }
        }
    }
}
