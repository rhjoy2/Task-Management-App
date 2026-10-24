// Run with: npm test (sets TZ=America/New_York so DST cases are deterministic)
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adjustSupply, buildCalendar, currentStreak, daily, dosesBetween, dosesOn, dosesPerDay, evaluate,
  frequencyLabel, isEveryDay, makeSchedule, nextDose, perMedication, rateOf, resolveState, supplyDays, total,
} from '../core.js';

const date = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const sched = (times, opts = {}) => makeSchedule({ times, startDate: date(2026, 10, 1), ...opts });

test('runs in America/New_York', () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, 'America/New_York');
});

test('schedule normalizes times and weekdays', () => {
  const s = makeSchedule({ times: [1200, 480, 480, -5, 1440, 7.5], weekdays: [9, 1, 1, -1], startDate: date(2026, 1, 1, 15) });
  assert.deepEqual(s.times, [480, 1200]);
  assert.deepEqual(s.weekdays, [1]);
  assert.equal(s.startDate, date(2026, 1, 1).getTime());
});

test('every-day doses come in order', () => {
  assert.deepEqual(dosesOn(sched([1200, 480]), date(2026, 10, 21, 15)), [date(2026, 10, 21, 8), date(2026, 10, 21, 20)]);
});

test('specific weekdays only', () => {
  // 2026-10-19 is a Monday (1), 2026-10-21 a Wednesday (3).
  const s = sched([540], { weekdays: [1, 3] });
  assert.equal(dosesOn(s, date(2026, 10, 19)).length, 1);
  assert.equal(dosesOn(s, date(2026, 10, 20)).length, 0);
  assert.equal(dosesOn(s, date(2026, 10, 21)).length, 1);
  assert.ok(Math.abs(dosesPerDay(s) - 2 / 7) < 1e-9);
  assert.equal(isEveryDay(sched([60], { weekdays: [0, 1, 2, 3, 4, 5, 6] })), true);
});

test('nothing before the start day or from the end time on', () => {
  const s = makeSchedule({ times: [480, 1200], startDate: date(2026, 10, 10, 15), endDate: date(2026, 10, 12, 12) });
  assert.equal(dosesOn(s, date(2026, 10, 9)).length, 0);
  assert.equal(dosesOn(s, date(2026, 10, 10)).length, 2);
  assert.deepEqual(dosesOn(s, date(2026, 10, 12)), [date(2026, 10, 12, 8)]);
  assert.equal(dosesOn(s, date(2026, 10, 13)).length, 0);
});

test('wall-clock time survives daylight-saving changes', () => {
  const s = makeSchedule({ times: [480], startDate: date(2026, 1, 1) });
  for (const d of [date(2026, 3, 7), date(2026, 3, 8), date(2026, 3, 9), date(2026, 11, 1), date(2026, 11, 2)]) {
    const [dose] = dosesOn(s, d);
    assert.equal(dose.getHours(), 8);
    assert.equal(dose.getMinutes(), 0);
  }
  // 23 and 25 hour days still yield exactly one dose per day.
  assert.equal(dosesBetween(s, date(2026, 3, 7), date(2026, 3, 10)).length, 3);
  assert.equal(dosesBetween(s, date(2026, 10, 31), date(2026, 11, 3)).length, 3);
});

test('dosesBetween is half-open', () => {
  assert.deepEqual(dosesBetween(sched([480, 1200]), date(2026, 10, 20, 8), date(2026, 10, 21, 20)),
    [date(2026, 10, 20, 8), date(2026, 10, 20, 20), date(2026, 10, 21, 8)]);
});

test('dose states', () => {
  const at = date(2026, 10, 21, 8);
  assert.equal(resolveState(at, undefined, date(2026, 10, 21, 7)), 'upcoming');
  assert.equal(resolveState(at, undefined, date(2026, 10, 21, 23, 59)), 'due');
  assert.equal(resolveState(at, undefined, date(2026, 10, 22, 0, 1)), 'missed');
  assert.equal(resolveState(at, 'taken', date(2026, 10, 20)), 'taken');
  assert.equal(resolveState(at, 'skipped', date(2026, 10, 25)), 'skipped');
});

test('daily adherence counts only resolved doses', () => {
  const meds = [{ id: 'a', schedule: makeSchedule({ times: [480, 1200], startDate: date(2026, 10, 19) }) }];
  const logs = [
    { medId: 'a', scheduled: date(2026, 10, 19, 8).getTime(), status: 'taken' },
    { medId: 'a', scheduled: date(2026, 10, 19, 20).getTime(), status: 'taken' },
    { medId: 'a', scheduled: date(2026, 10, 20, 8).getTime(), status: 'skipped' },
    { medId: 'a', scheduled: date(2026, 10, 21, 8).getTime(), status: 'taken' },
  ];
  const days = daily(meds, logs, 4, date(2026, 10, 21, 12));
  assert.deepEqual(days.map((d) => d.day), [date(2026, 10, 18), date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 21)]);
  assert.deepEqual(days.map((d) => d.stats), [
    { taken: 0, skipped: 0, missed: 0 },
    { taken: 2, skipped: 0, missed: 0 },
    { taken: 0, skipped: 1, missed: 1 },
    { taken: 1, skipped: 0, missed: 0 }, // tonight's dose is still upcoming
  ]);
  const t = total(days);
  assert.deepEqual(t, { taken: 3, skipped: 1, missed: 1 });
  assert.equal(rateOf(t), 0.6);
  assert.equal(rateOf({ taken: 0, skipped: 0, missed: 0 }), null);
});

test('logs off the current schedule are kept', () => {
  const meds = [{ id: 'a', schedule: makeSchedule({ times: [540], startDate: date(2026, 10, 21) }) }];
  const logs = [{ medId: 'a', scheduled: date(2026, 10, 20, 8).getTime(), status: 'taken' }];
  const doses = evaluate(meds, logs, date(2026, 10, 20), date(2026, 10, 22), date(2026, 10, 21, 10));
  assert.deepEqual(doses.map((d) => [d.scheduled.getTime(), d.state]),
    [[date(2026, 10, 20, 8).getTime(), 'taken'], [date(2026, 10, 21, 9).getTime(), 'due']]);
});

test('logs for other medications are ignored', () => {
  const meds = [{ id: 'a', schedule: makeSchedule({ times: [480], startDate: date(2026, 10, 21) }) }];
  const logs = [{ medId: 'b', scheduled: date(2026, 10, 21, 8).getTime(), status: 'taken' }];
  const stats = perMedication(meds, logs, date(2026, 10, 21), date(2026, 10, 22), date(2026, 10, 22, 1));
  assert.deepEqual([...stats], [['a', { taken: 0, skipped: 0, missed: 1 }]]);
});

test('streak skips empty days and stops at an imperfect one', () => {
  const s = (taken, skipped = 0, missed = 0) => ({ stats: { taken, skipped, missed } });
  assert.equal(currentStreak([s(2), s(1, 0, 1), s(2), s(0), s(1), s(2), s(0)]), 3);
  assert.equal(currentStreak([s(0, 1)]), 0);
  assert.equal(currentStreak([]), 0);
});

test('next reminder skips logged and past doses', () => {
  const meds = [
    { id: 'a', schedule: sched([480, 1200]) },
    { id: 'b', schedule: sched([720]) },
  ];
  const logs = [{ medId: 'b', scheduled: date(2026, 10, 21, 12).getTime(), status: 'taken' }];
  assert.deepEqual(nextDose(meds, logs, date(2026, 10, 21, 9)), { medId: 'a', scheduled: date(2026, 10, 21, 20) });
  assert.deepEqual(nextDose([meds[1]], logs, date(2026, 10, 21, 9)), { medId: 'b', scheduled: date(2026, 10, 22, 12) });
  assert.equal(nextDose([], [], date(2026, 10, 21)), null);
});

test('supply estimate and adjustment', () => {
  assert.equal(supplyDays(30, 1, 2), 15);
  assert.equal(supplyDays(5, 2, 1), 2);
  assert.equal(supplyDays(4, 1, 2 / 7), 14);
  assert.equal(supplyDays(10, 0, 1), null);
  assert.equal(supplyDays(10, 1, 0), null);
  assert.equal(adjustSupply(10, 2, null, 'taken'), 8);
  assert.equal(adjustSupply(8, 2, 'taken', null), 10);
  assert.equal(adjustSupply(8, 2, 'taken', 'skipped'), 10);
  assert.equal(adjustSupply(8, 2, 'skipped', null), 8);
  assert.equal(adjustSupply(8, 2, 'taken', 'taken'), 8);
  assert.equal(adjustSupply(1, 2, null, 'taken'), 0);
});

test('frequency labels', () => {
  assert.deepEqual(frequencyLabel(sched([480, 1200])), { text: 'Twice a day', abbr: 'BID' });
  assert.deepEqual(frequencyLabel(sched([480], { weekdays: [1, 4] })), { text: 'Once a day, 2 days a week', abbr: null });
});

test('calendar file has one repeating event with an alert per dose time', () => {
  const meds = [
    { id: 'a', name: 'Metformin, ER', dosage: '500 mg', notes: 'With food', schedule: sched([480, 1200]) },
    { id: 'b', name: 'Vitamin D', dosage: '', notes: '', schedule: sched([540], { weekdays: [1, 3] }) },
  ];
  const ics = buildCalendar(meds, { now: date(2026, 10, 21, 10) }); // a Wednesday
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'uses CRLF line endings');
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 3);
  assert.equal(ics.match(/BEGIN:VALARM/g).length, 3);
  assert.match(ics, /DTSTART:20261021T080000\r\n/);
  assert.match(ics, /SUMMARY:Take Metformin\\, ER \(500 mg\)/);
  assert.match(ics, /RRULE:FREQ=WEEKLY;BYDAY=MO,WE/);
  assert.match(ics, /DTSTART:20261021T090000/);
  for (const line of ics.split('\r\n')) assert.ok(new TextEncoder().encode(line).length <= 75, line);

  const hidden = buildCalendar(meds, { now: date(2026, 10, 21), hideNames: true });
  assert.ok(!hidden.includes('Metformin'));

  const stopped = [{ ...meds[0], schedule: { ...meds[0].schedule, endDate: date(2026, 10, 20).getTime() } }];
  assert.ok(!buildCalendar(stopped, { now: date(2026, 10, 21) }).includes('VEVENT'));
});
