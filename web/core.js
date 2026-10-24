// DoseDay core logic: scheduling, dose states, adherence, reminders, supply
// and calendar export. No DOM access, so it runs in the browser and in Node
// tests alike. All dates are local time.

export const MINUTES_PER_DAY = 24 * 60;
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

// ---------------------------------------------------------------- dates

export function startOfDay(date) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Start of the day `n` calendar days after `date` (DST-safe). */
export function addDays(date, n) {
  const d = new Date(date);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function sameDay(a, b) {
  return startOfDay(a).getTime() === startOfDay(b).getTime();
}

/** Local date at `minutes` after midnight on the day of `day`. */
export function atMinutes(day, minutes) {
  const d = new Date(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60);
}

export function minutesOf(date) {
  const d = new Date(date);
  return d.getHours() * 60 + d.getMinutes();
}

// ---------------------------------------------------------------- schedules

/**
 * A schedule is { times: number[] (minutes after midnight),
 * weekdays: number[] (0 = Sunday … 6; empty = every day),
 * startDate: ms, endDate: ms | null }.
 */
export function makeSchedule({ times = [], weekdays = [], startDate, endDate = null }) {
  return {
    times: [...new Set(times.filter((t) => Number.isInteger(t) && t >= 0 && t < MINUTES_PER_DAY))].sort((a, b) => a - b),
    weekdays: [...new Set(weekdays.filter((w) => Number.isInteger(w) && w >= 0 && w <= 6))].sort((a, b) => a - b),
    startDate: startOfDay(startDate).getTime(),
    endDate: endDate == null ? null : new Date(endDate).getTime(),
  };
}

export function isEveryDay(schedule) {
  return schedule.weekdays.length === 0 || schedule.weekdays.length === 7;
}

export function dosesPerDay(schedule) {
  return schedule.times.length * (isEveryDay(schedule) ? 1 : schedule.weekdays.length / 7);
}

export function isActiveOn(schedule, day) {
  const d = startOfDay(day).getTime();
  if (d < schedule.startDate) return false;
  if (schedule.endDate != null && d >= schedule.endDate) return false;
  return isEveryDay(schedule) || schedule.weekdays.includes(new Date(d).getDay());
}

/** Doses on the calendar day containing `day`, in order. */
export function dosesOn(schedule, day) {
  if (!isActiveOn(schedule, day)) return [];
  return schedule.times
    .map((t) => atMinutes(day, t))
    .filter((d) => schedule.endDate == null || d.getTime() < schedule.endDate);
}

/** Every dose with start <= dose < end. */
export function dosesBetween(schedule, start, end) {
  const out = [];
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  for (let day = startOfDay(start); day.getTime() < e; day = addDays(day, 1)) {
    for (const d of dosesOn(schedule, day)) {
      if (d.getTime() >= s && d.getTime() < e) out.push(d);
    }
  }
  return out;
}

// ---------------------------------------------------------------- dose state

export const doseKey = (medId, time) => `${medId}@${new Date(time).getTime()}`;

/** 'upcoming' | 'due' | 'taken' | 'skipped' | 'missed' */
export function resolveState(scheduled, logged, now) {
  if (logged === 'taken' || logged === 'skipped') return logged;
  if (now < scheduled) return 'upcoming';
  return sameDay(scheduled, now) ? 'due' : 'missed';
}

/**
 * Every dose of `meds` ({ id, schedule }) with start <= dose < end, with its
 * state. Logs ({ medId, scheduled, status }) whose time is no longer on the
 * schedule are kept, so editing a schedule never erases history.
 */
export function evaluate(meds, logs, start, end, now) {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  const status = new Map(logs.map((l) => [doseKey(l.medId, l.scheduled), l.status]));
  const ids = new Set(meds.map((m) => m.id));
  const doses = new Map();
  for (const med of meds) {
    for (const d of dosesBetween(med.schedule, start, end)) {
      doses.set(doseKey(med.id, d), { medId: med.id, scheduled: d });
    }
  }
  for (const log of logs) {
    if (ids.has(log.medId) && log.scheduled >= s && log.scheduled < e) {
      doses.set(doseKey(log.medId, log.scheduled), { medId: log.medId, scheduled: new Date(log.scheduled) });
    }
  }
  return [...doses.values()]
    .map((d) => ({ ...d, state: resolveState(d.scheduled, status.get(doseKey(d.medId, d.scheduled)), now) }))
    .sort((a, b) => a.scheduled - b.scheduled || a.medId.localeCompare(b.medId));
}

// ---------------------------------------------------------------- adherence

export const emptyStats = () => ({ taken: 0, skipped: 0, missed: 0 });
export const resolvedCount = (s) => s.taken + s.skipped + s.missed;
export const rateOf = (s) => (resolvedCount(s) === 0 ? null : s.taken / resolvedCount(s));
export const isPerfect = (s) => resolvedCount(s) > 0 && s.taken === resolvedCount(s);

export function record(stats, state) {
  if (state === 'taken' || state === 'skipped' || state === 'missed') stats[state] += 1;
  return stats;
}

/** One entry per day for the `days` days ending today, oldest first. */
export function daily(meds, logs, days, now) {
  if (days <= 0) return [];
  const today = startOfDay(now);
  const result = [];
  for (let i = days - 1; i >= 0; i -= 1) result.push({ day: addDays(today, -i), stats: emptyStats() });
  const byDay = new Map(result.map((r) => [r.day.getTime(), r.stats]));
  for (const dose of evaluate(meds, logs, result[0].day, addDays(today, 1), now)) {
    const stats = byDay.get(startOfDay(dose.scheduled).getTime());
    if (stats) record(stats, dose.state);
  }
  return result;
}

export function total(days) {
  return days.reduce((acc, d) => ({
    taken: acc.taken + d.stats.taken,
    skipped: acc.skipped + d.stats.skipped,
    missed: acc.missed + d.stats.missed,
  }), emptyStats());
}

export function perMedication(meds, logs, start, end, now) {
  const result = new Map();
  for (const dose of evaluate(meds, logs, start, end, now)) {
    if (!result.has(dose.medId)) result.set(dose.medId, emptyStats());
    record(result.get(dose.medId), dose.state);
  }
  return result;
}

/** Consecutive perfect days back from the latest; days with nothing resolved are skipped. */
export function currentStreak(days) {
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i -= 1) {
    const s = days[i].stats;
    if (resolvedCount(s) === 0) continue;
    if (!isPerfect(s)) break;
    streak += 1;
  }
  return streak;
}

// ---------------------------------------------------------------- reminders

/** The soonest unlogged dose strictly after `now`, within `horizonDays`. */
export function nextDose(meds, logs, now, horizonDays = 8) {
  const logged = new Set(logs.map((l) => doseKey(l.medId, l.scheduled)));
  let best = null;
  const end = addDays(now, horizonDays);
  for (const med of meds) {
    for (const d of dosesBetween(med.schedule, now, end)) {
      if (d.getTime() <= new Date(now).getTime() || logged.has(doseKey(med.id, d))) continue;
      if (!best || d < best.scheduled) best = { medId: med.id, scheduled: d };
      break; // doses come in order; the first unlogged one is this med's soonest
    }
  }
  return best;
}

// ---------------------------------------------------------------- supply

/** Whole days the supply lasts, or null when it can't be estimated. */
export function supplyDays(units, perDose, perDay) {
  if (!(perDose > 0) || !(perDay > 0)) return null;
  return Math.floor(Math.max(units, 0) / (perDose * perDay) + 1e-9);
}

/** Units left after a dose's status changes from `from` to `to` (null = not logged). */
export function adjustSupply(units, perDose, from, to) {
  const was = from === 'taken';
  const is = to === 'taken';
  if (was === is) return units;
  return is ? Math.max(0, units - perDose) : units + perDose;
}

// ---------------------------------------------------------------- wording

const TIMES_WORDS = ['', 'Once', 'Twice', 'Three times', 'Four times'];
const LATIN = ['', 'QD', 'BID', 'TID', 'QID'];

/** Plain-language frequency, plus the pharmacy abbreviation where one applies. */
export function frequencyLabel(schedule) {
  const n = schedule.times.length;
  const count = TIMES_WORDS[n] ?? `${n} times`;
  if (isEveryDay(schedule)) return { text: `${count} a day`, abbr: LATIN[n] ?? `${n}×/day` };
  return { text: `${count} a day, ${schedule.weekdays.length} days a week`, abbr: null };
}

// ---------------------------------------------------------------- calendar

function icsText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function icsFold(line) {
  // Lines longer than 75 octets are continued with CRLF + space (RFC 5545 §3.1).
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += n;
  }
  out.push(current);
  return out.join('\r\n ');
}

const pad = (n) => String(n).padStart(2, '0');
const icsLocal = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
const icsUtc = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/**
 * An iCalendar file with one repeating event (with an alert) per dose time,
 * so reminders arrive from the person's calendar app even when DoseDay
 * isn't open. Times are "floating", so they follow the device's time zone.
 */
export function buildCalendar(meds, { now = new Date(), hideNames = false } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//DoseDay//Medication reminders//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:DoseDay reminders'];
  for (const med of meds) {
    const { schedule } = med;
    if (schedule.endDate != null && schedule.endDate <= new Date(now).getTime()) continue;
    // First day the schedule is active, so DTSTART is itself an occurrence.
    let first = startOfDay(Math.max(schedule.startDate, startOfDay(now).getTime()));
    for (let i = 0; i < 7 && !isActiveOn(schedule, first); i += 1) first = addDays(first, 1);
    if (!isActiveOn(schedule, first)) continue;

    const rule = isEveryDay(schedule)
      ? 'FREQ=DAILY'
      : `FREQ=WEEKLY;BYDAY=${schedule.weekdays.map((w) => DAY_CODES[w]).join(',')}`;
    // UNTIL must be floating too when DTSTART is floating (RFC 5545 §3.3.10).
    const until = schedule.endDate != null ? `;UNTIL=${icsLocal(new Date(schedule.endDate))}` : '';
    const title = hideNames ? 'Medication reminder' : `Take ${med.name}${med.dosage ? ` (${med.dosage})` : ''}`;
    for (const t of schedule.times) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${med.id}-${t}@doseday`,
        `DTSTAMP:${icsUtc(new Date(now))}`,
        `DTSTART:${icsLocal(atMinutes(first, t))}`,
        'DURATION:PT5M',
        `RRULE:${rule}${until}`,
        `SUMMARY:${icsText(title)}`,
        `DESCRIPTION:${icsText(hideNames || !med.notes ? 'Log it in DoseDay.' : `${med.notes}\nLog it in DoseDay.`)}`,
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${icsText(title)}`,
        'TRIGGER:PT0M',
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}
