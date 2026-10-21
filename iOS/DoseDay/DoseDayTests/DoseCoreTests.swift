import XCTest

#if SWIFT_PACKAGE
@testable import DoseCore
#else
@testable import DoseDay
#endif

final class DoseCoreTests: XCTestCase {
    private var calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "America/New_York")!
        return calendar
    }()

    private func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 0, _ minute: Int = 0) -> Date {
        calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
    }

    private let medA = UUID()
    private let medB = UUID()

    // MARK: - DoseSchedule

    func testScheduleNormalizesTimesAndWeekdays() {
        let schedule = DoseSchedule(times: [1200, 480, 480, -5, 1440], weekdays: [0, 2, 8], startDate: date(2026, 1, 1))
        XCTAssertEqual(schedule.times, [480, 1200])
        XCTAssertEqual(schedule.weekdays, [2])
    }

    func testEveryDayDosesAreInOrder() {
        let schedule = DoseSchedule(times: [20 * 60, 8 * 60], startDate: date(2026, 10, 1))
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 21, 15), calendar: calendar), [date(2026, 10, 21, 8), date(2026, 10, 21, 20)])
    }

    func testSpecificWeekdaysOnly() {
        // 2026-10-19 is a Monday (weekday 2).
        let schedule = DoseSchedule(times: [9 * 60], weekdays: [2, 4], startDate: date(2026, 10, 1))
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 19), calendar: calendar).count, 1)
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 20), calendar: calendar).count, 0)
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 21), calendar: calendar).count, 1)
        XCTAssertEqual(schedule.dosesPerDay, 2.0 / 7.0, accuracy: 0.0001)
    }

    func testAllSevenWeekdaysCountsAsEveryDay() {
        let schedule = DoseSchedule(times: [60], weekdays: Set(1...7), startDate: date(2026, 1, 1))
        XCTAssertTrue(schedule.isEveryDay)
        XCTAssertEqual(schedule.dosesPerDay, 1)
    }

    func testNoDosesBeforeStartDayOrAfterEnd() {
        let schedule = DoseSchedule(
            times: [8 * 60, 20 * 60],
            startDate: date(2026, 10, 10, 15),
            endDate: date(2026, 10, 12, 12)
        )
        XCTAssertTrue(schedule.doses(on: date(2026, 10, 9), calendar: calendar).isEmpty)
        // The whole start day counts, even doses earlier than the moment it was created.
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 10), calendar: calendar).count, 2)
        XCTAssertEqual(schedule.doses(on: date(2026, 10, 12), calendar: calendar), [date(2026, 10, 12, 8)])
        XCTAssertTrue(schedule.doses(on: date(2026, 10, 13), calendar: calendar).isEmpty)
    }

    func testWallClockTimeKeptAcrossDaylightSavingChange() {
        // Clocks in New York go forward on 2026-03-08 and back on 2026-11-01.
        let schedule = DoseSchedule(times: [8 * 60], startDate: date(2026, 1, 1))
        for day in [date(2026, 3, 7), date(2026, 3, 8), date(2026, 3, 9), date(2026, 11, 1), date(2026, 11, 2)] {
            let dose = schedule.doses(on: day, calendar: calendar)[0]
            XCTAssertEqual(calendar.component(.hour, from: dose), 8)
            XCTAssertEqual(calendar.component(.minute, from: dose), 0)
        }
    }

    func testDosesInRangeIsHalfOpen() {
        let schedule = DoseSchedule(times: [8 * 60, 20 * 60], startDate: date(2026, 10, 1))
        let doses = schedule.doses(from: date(2026, 10, 20, 8), to: date(2026, 10, 21, 20), calendar: calendar)
        XCTAssertEqual(doses, [date(2026, 10, 20, 8), date(2026, 10, 20, 20), date(2026, 10, 21, 8)])
    }

    // MARK: - DoseState

    func testDoseStateResolution() {
        let scheduled = date(2026, 10, 21, 8)
        XCTAssertEqual(DoseState.resolve(scheduled: scheduled, logged: nil, now: date(2026, 10, 21, 7), calendar: calendar), .upcoming)
        XCTAssertEqual(DoseState.resolve(scheduled: scheduled, logged: nil, now: date(2026, 10, 21, 23, 59), calendar: calendar), .due)
        XCTAssertEqual(DoseState.resolve(scheduled: scheduled, logged: nil, now: date(2026, 10, 22, 0, 1), calendar: calendar), .missed)
        XCTAssertEqual(DoseState.resolve(scheduled: scheduled, logged: .taken, now: date(2026, 10, 20), calendar: calendar), .taken)
        XCTAssertEqual(DoseState.resolve(scheduled: scheduled, logged: .skipped, now: date(2026, 10, 25), calendar: calendar), .skipped)
    }

    // MARK: - Adherence

    func testDailyAdherenceCountsOnlyResolvedDoses() {
        let meds = [ScheduledMedication(id: medA, schedule: DoseSchedule(times: [8 * 60, 20 * 60], startDate: date(2026, 10, 19)))]
        let logs: [DoseKey: DoseStatus] = [
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 19, 8)): .taken,
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 19, 20)): .taken,
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 20, 8)): .skipped,
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 21, 8)): .taken,
        ]
        let days = AdherenceCalculator.daily(meds, logs: logs, days: 4, now: date(2026, 10, 21, 12), calendar: calendar)

        XCTAssertEqual(days.map(\.day), [date(2026, 10, 18), date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 21)])
        XCTAssertEqual(days[0].stats, AdherenceStats())
        XCTAssertEqual(days[1].stats, AdherenceStats(taken: 2))
        XCTAssertEqual(days[2].stats, AdherenceStats(skipped: 1, missed: 1))
        // Today's 8 PM dose is still upcoming and doesn't count yet.
        XCTAssertEqual(days[3].stats, AdherenceStats(taken: 1))

        let total = AdherenceCalculator.total(days)
        XCTAssertEqual(total, AdherenceStats(taken: 3, skipped: 1, missed: 1))
        XCTAssertEqual(total.rate!, 0.6, accuracy: 0.0001)
    }

    func testLogsOffTheCurrentScheduleAreKept() {
        // The schedule moved to 9 AM starting today; yesterday's 8 AM log must still count.
        let meds = [ScheduledMedication(id: medA, schedule: DoseSchedule(times: [9 * 60], startDate: date(2026, 10, 21)))]
        let logs: [DoseKey: DoseStatus] = [DoseKey(medicationID: medA, scheduled: date(2026, 10, 20, 8)): .taken]
        let doses = AdherenceCalculator.evaluate(meds, logs: logs, from: date(2026, 10, 20), to: date(2026, 10, 22), now: date(2026, 10, 21, 10), calendar: calendar)
        XCTAssertEqual(doses.map(\.key.scheduled), [date(2026, 10, 20, 8), date(2026, 10, 21, 9)])
        XCTAssertEqual(doses.map(\.state), [.taken, .due])
    }

    func testLogsForOtherMedicationsAreIgnored() {
        let meds = [ScheduledMedication(id: medA, schedule: DoseSchedule(times: [8 * 60], startDate: date(2026, 10, 21)))]
        let logs: [DoseKey: DoseStatus] = [DoseKey(medicationID: medB, scheduled: date(2026, 10, 21, 8)): .taken]
        let stats = AdherenceCalculator.perMedication(meds, logs: logs, from: date(2026, 10, 21), to: date(2026, 10, 22), now: date(2026, 10, 22, 1), calendar: calendar)
        XCTAssertEqual(stats, [medA: AdherenceStats(missed: 1)])
    }

    func testRateIsNilWhenNothingResolved() {
        XCTAssertNil(AdherenceStats().rate)
        XCTAssertFalse(AdherenceStats().isPerfect)
    }

    func testStreakSkipsEmptyDaysAndStopsAtImperfectDay() {
        func day(_ d: Int, _ stats: AdherenceStats) -> DayAdherence { DayAdherence(day: date(2026, 10, d), stats: stats) }
        let days = [
            day(15, AdherenceStats(taken: 2)),
            day(16, AdherenceStats(taken: 1, missed: 1)),
            day(17, AdherenceStats(taken: 2)),
            day(18, AdherenceStats()), // nothing scheduled
            day(19, AdherenceStats(taken: 1)),
            day(20, AdherenceStats(taken: 2)),
            day(21, AdherenceStats()), // today, nothing due yet
        ]
        XCTAssertEqual(AdherenceCalculator.currentStreak(days), 3)
        XCTAssertEqual(AdherenceCalculator.currentStreak([day(21, AdherenceStats(skipped: 1))]), 0)
        XCTAssertEqual(AdherenceCalculator.currentStreak([]), 0)
    }

    // MARK: - Reminders

    func testReminderPlanSkipsLoggedAndPastDosesAndIsSorted() {
        let meds = [
            ScheduledMedication(id: medA, schedule: DoseSchedule(times: [8 * 60, 20 * 60], startDate: date(2026, 10, 1))),
            ScheduledMedication(id: medB, schedule: DoseSchedule(times: [12 * 60], startDate: date(2026, 10, 1))),
        ]
        let takenEarly = DoseKey(medicationID: medB, scheduled: date(2026, 10, 21, 12))
        let plan = ReminderPlanner.upcoming(
            for: meds,
            excluding: [takenEarly],
            after: date(2026, 10, 21, 9),
            horizonDays: 2,
            calendar: calendar
        )
        XCTAssertEqual(plan, [
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 21, 20)),
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 22, 8)),
            DoseKey(medicationID: medB, scheduled: date(2026, 10, 22, 12)),
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 22, 20)),
            DoseKey(medicationID: medA, scheduled: date(2026, 10, 23, 8)),
        ])
    }

    func testReminderPlanRespectsLimit() {
        let meds = [ScheduledMedication(id: medA, schedule: DoseSchedule(times: Array(stride(from: 0, to: 1440, by: 60)), startDate: date(2026, 1, 1)))]
        let plan = ReminderPlanner.upcoming(for: meds, excluding: [], after: date(2026, 10, 21), calendar: calendar)
        XCTAssertEqual(plan.count, ReminderPlanner.defaultLimit)
        XCTAssertEqual(plan.first?.scheduled, date(2026, 10, 21, 1))
        XCTAssertTrue(plan.allSatisfy { $0.scheduled > date(2026, 10, 21) })
    }

    func testReminderPlanStopsAtEndDate() {
        let meds = [ScheduledMedication(id: medA, schedule: DoseSchedule(times: [8 * 60], startDate: date(2026, 1, 1), endDate: date(2026, 10, 21, 10)))]
        XCTAssertTrue(ReminderPlanner.upcoming(for: meds, excluding: [], after: date(2026, 10, 21, 9), calendar: calendar).isEmpty)
    }

    // MARK: - Supply

    func testSupplyEstimate() {
        XCTAssertEqual(SupplyEstimator.daysRemaining(units: 30, unitsPerDose: 1, dosesPerDay: 2), 15)
        XCTAssertEqual(SupplyEstimator.daysRemaining(units: 5, unitsPerDose: 2, dosesPerDay: 1), 2)
        XCTAssertEqual(SupplyEstimator.daysRemaining(units: 4, unitsPerDose: 1, dosesPerDay: 2.0 / 7.0), 14)
        XCTAssertNil(SupplyEstimator.daysRemaining(units: 10, unitsPerDose: 0, dosesPerDay: 1))
        XCTAssertNil(SupplyEstimator.daysRemaining(units: 10, unitsPerDose: 1, dosesPerDay: 0))
    }

    func testSupplyAdjustsOnlyWhenTakenChanges() {
        XCTAssertEqual(SupplyEstimator.adjust(units: 10, unitsPerDose: 2, from: nil, to: .taken), 8)
        XCTAssertEqual(SupplyEstimator.adjust(units: 8, unitsPerDose: 2, from: .taken, to: nil), 10)
        XCTAssertEqual(SupplyEstimator.adjust(units: 8, unitsPerDose: 2, from: .taken, to: .skipped), 10)
        XCTAssertEqual(SupplyEstimator.adjust(units: 8, unitsPerDose: 2, from: .skipped, to: nil), 8)
        XCTAssertEqual(SupplyEstimator.adjust(units: 8, unitsPerDose: 2, from: .taken, to: .taken), 8)
        XCTAssertEqual(SupplyEstimator.adjust(units: 1, unitsPerDose: 2, from: nil, to: .taken), 0)
    }
}
