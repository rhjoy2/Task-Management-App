// DoseDay UI. Data lives in this browser's localStorage only.
import * as core from './core.js';

const STORAGE_KEY = 'doseday.v1';
const VIEWS = ['today', 'medications', 'history', 'preferences'];
const COLORS = ['green', 'blue', 'violet', 'rose', 'amber', 'teal', 'red', 'slate'];
const SNOOZE_MINUTES = 10;
const REMIND_WINDOW_MINUTES = 30; // don't pop reminders for doses older than this
const PERIODS = [
  { title: 'Morning', test: (m) => m >= 240 && m < 720 },
  { title: 'Afternoon', test: (m) => m >= 720 && m < 1020 },
  { title: 'Evening', test: (m) => m >= 1020 && m < 1260 },
  { title: 'Night', test: () => true },
];

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const fmt = {
  time: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }),
  long: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
  weekday: new Intl.DateTimeFormat(undefined, { weekday: 'long' }),
  weekdayShort: new Intl.DateTimeFormat(undefined, { weekday: 'short' }),
  dayMonth: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
  full: new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
  pct: new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }),
};
const minutesText = (m) => fmt.time.format(core.atMinutes(new Date(), m));
// 2026-10-18 is a Sunday, so day i of that week has getDay() === i.
const weekdayName = (i, style = 'weekdayShort') => fmt[style].format(new Date(2026, 9, 18 + i));
const weekOrder = (() => {
  let first = 1;
  try {
    const info = new Intl.Locale(navigator.language).weekInfo ?? new Intl.Locale(navigator.language).getWeekInfo?.();
    if (info?.firstDay) first = info.firstDay % 7;
  } catch { /* keep Monday */ }
  return Array.from({ length: 7 }, (_, i) => (first + i) % 7);
})();

// ---------------------------------------------------------------- storage

const storage = (() => {
  try {
    const probe = '__doseday_probe';
    localStorage.setItem(probe, probe);
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
})();
let saveFailed = false;

const blankData = () => ({ version: 1, medications: [], logs: [], settings: { hideNames: false, reminderPromptDismissed: false }, sample: false });

function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.medications) || !Array.isArray(raw.logs)) return null;
  const base = blankData();
  const medications = raw.medications
    .filter((m) => m && typeof m.id === 'string' && typeof m.name === 'string')
    .map((m) => ({
      id: m.id,
      name: m.name.slice(0, 80),
      dosage: String(m.dosage ?? '').slice(0, 60),
      notes: String(m.notes ?? '').slice(0, 300),
      color: COLORS.includes(m.color) ? m.color : 'green',
      times: core.makeSchedule({ times: m.times ?? [], startDate: 0 }).times,
      weekdays: core.makeSchedule({ weekdays: m.weekdays ?? [], startDate: 0 }).weekdays,
      startDate: Number.isFinite(m.startDate) ? m.startDate : core.startOfDay(new Date()).getTime(),
      archivedAt: Number.isFinite(m.archivedAt) ? m.archivedAt : null,
      tracksSupply: Boolean(m.tracksSupply),
      supply: Math.max(0, Math.floor(Number(m.supply) || 0)),
      perDose: Math.max(1, Math.floor(Number(m.perDose) || 1)),
      refillDays: Math.max(0, Math.floor(Number(m.refillDays ?? 7) || 0)),
      createdAt: Number.isFinite(m.createdAt) ? m.createdAt : Date.now(),
    }));
  const ids = new Set(medications.map((m) => m.id));
  const seen = new Set();
  const logs = raw.logs
    .filter((l) => l && ids.has(l.medId) && Number.isFinite(l.scheduled) && (l.status === 'taken' || l.status === 'skipped'))
    .filter((l) => {
      const key = core.doseKey(l.medId, l.scheduled);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((l) => ({ medId: l.medId, scheduled: l.scheduled, status: l.status, loggedAt: Number.isFinite(l.loggedAt) ? l.loggedAt : l.scheduled }));
  return {
    ...base,
    medications,
    logs,
    settings: { ...base.settings, ...(raw.settings && typeof raw.settings === 'object' ? raw.settings : {}) },
    sample: Boolean(raw.sample),
  };
}

function load() {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save() {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}

// Sample medications so a first visit shows how the tracker works. They are
// labelled as samples and removed as soon as the person adds their own.
function sampleData(now = new Date()) {
  const d = blankData();
  const start = core.addDays(now, -24).getTime();
  const med = (name, dosage, color, times, extra = {}) => ({
    id: uid(), name, dosage, notes: '', color, times, weekdays: [], startDate: start, archivedAt: null,
    tracksSupply: false, supply: 0, perDose: 1, refillDays: 7, createdAt: start, ...extra,
  });
  d.medications = [
    med('Metformin', '500 mg tablet', 'blue', [480, 1200], { notes: 'Take with breakfast and dinner.', tracksSupply: true, supply: 9, perDose: 1, refillDays: 7 }),
    med('Lisinopril', '10 mg tablet', 'rose', [450]),
    med('Vitamin D3', '1,000 IU', 'amber', [540], { weekdays: [1, 3, 5] }),
  ];
  const doses = core.evaluate(d.medications.map(toCore), [], new Date(start), now, now);
  doses.forEach((dose, i) => {
    if (i % 13 === 7) return; // left unlogged
    d.logs.push({
      medId: dose.medId,
      scheduled: dose.scheduled.getTime(),
      status: i % 17 === 5 ? 'skipped' : 'taken',
      loggedAt: dose.scheduled.getTime() + ((i * 7) % 25) * 60000,
    });
  });
  d.sample = true;
  return d;
}

const toCore = (m) => ({
  id: m.id,
  name: m.name,
  dosage: m.dosage,
  notes: m.notes,
  schedule: core.makeSchedule({ times: m.times, weekdays: m.weekdays, startDate: m.startDate, endDate: m.archivedAt }),
});

let data = load();
if (!data) {
  data = sampleData();
  save();
}

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return;
  const fresh = load();
  if (fresh) {
    data = fresh;
    render();
  }
});

// ---------------------------------------------------------------- derived data

const byId = (id) => data.medications.find((m) => m.id === id);
const coreMeds = () => data.medications.map(toCore);
const findLog = (medId, t) => data.logs.find((l) => l.medId === medId && l.scheduled === t);

function supplyInfo(m) {
  if (!m.tracksSupply) return null;
  const days = core.supplyDays(m.supply, m.perDose, core.dosesPerDay(toCore(m).schedule));
  const low = m.archivedAt == null && days != null && days <= m.refillDays;
  const unit = m.supply === 1 ? 'dose' : 'doses';
  const text = days == null ? `${m.supply} ${unit} left` : `${m.supply} ${unit} left, about ${plural(days, 'day')}`;
  return { days, low, text };
}

function dosesFor(day, now = new Date()) {
  const meds = coreMeds();
  return core.evaluate(meds, data.logs, core.startOfDay(day), core.addDays(day, 1), now)
    .map((d) => ({ ...d, med: byId(d.medId), log: findLog(d.medId, d.scheduled.getTime()) }))
    .filter((d) => d.med)
    .sort((a, b) => a.scheduled - b.scheduled || a.med.name.localeCompare(b.med.name));
}

// ---------------------------------------------------------------- actions

function setDose(medId, scheduled, status) {
  const med = byId(medId);
  if (!med) return;
  const existing = findLog(medId, scheduled);
  const previous = existing?.status ?? null;
  if (status == null) {
    data.logs = data.logs.filter((l) => l !== existing);
  } else if (existing) {
    existing.status = status;
    existing.loggedAt = Date.now();
  } else {
    data.logs.push({ medId, scheduled, status, loggedAt: Date.now() });
  }
  if (med.tracksSupply) med.supply = core.adjustSupply(med.supply, med.perDose, previous, status);
  const key = core.doseKey(medId, scheduled);
  snoozed.delete(key);
  removeToast(key);
  save();
  render();
}

function clearSamples() {
  if (!data.sample) return;
  data = { ...blankData(), settings: data.settings };
  save();
}

// ---------------------------------------------------------------- UI state

const ui = {
  view: VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'today',
  day: core.startOfDay(new Date()),
  followToday: true,
  range: 7,
  pendingImport: null,
  confirmWipe: false,
};

function go(view) {
  if (!VIEWS.includes(view)) return;
  ui.view = view;
  try { history.replaceState(null, '', `#${view}`); } catch { /* sandboxed */ }
  render();
  $('#main').focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- rendering

const main = $('#main');

function render() {
  for (const a of document.querySelectorAll('[data-tab]')) {
    if (a.dataset.tab === ui.view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const html = {
    today: renderToday,
    medications: renderMedications,
    history: renderHistory,
    preferences: renderPreferences,
  }[ui.view]();
  main.innerHTML = html + renderFooter();
  updateTitle();
  lastSignature = signature();
}

function renderFooter() {
  return `<footer class="foot">DoseDay helps you keep track. It isn't medical advice: follow your doctor's or pharmacist's instructions, and call your local emergency number in an emergency. Your data stays in this browser.</footer>`;
}

function banners({ today }) {
  const out = [];
  if (!storage || saveFailed) {
    out.push(`<div class="banner warn" role="status"><p><strong>This browser isn't saving DoseDay's data.</strong> Private browsing or blocked site data can cause this. Anything you add will be gone when you close the tab.</p></div>`);
  }
  if (data.sample) {
    out.push(`<div class="banner sample"><p><strong>These are sample medications</strong> so you can see how DoseDay works. Your own list replaces them as soon as you add a medication.</p><div class="row"><button class="btn btn-primary btn-small" data-action="new-med">Add my first medication</button><button class="btn btn-small" data-action="clear-samples">Clear samples</button></div></div>`);
  }
  if (today && data.medications.length && 'Notification' in window && Notification.permission === 'default' && !data.settings.reminderPromptDismissed) {
    out.push(`<div class="banner"><p>Get a reminder at each dose time while DoseDay is open in a browser tab.</p><div class="row"><button class="btn btn-primary btn-small" data-action="enable-reminders">Turn on reminders</button><button class="btn btn-quiet btn-small" data-action="dismiss-reminders">Not now</button></div></div>`);
  }
  if (today) {
    for (const m of data.medications) {
      const s = supplyInfo(m);
      if (s?.low) out.push(`<div class="banner warn"><p><strong>Refill ${esc(m.name)} soon.</strong> ${esc(s.text)}.</p><button class="btn btn-small" data-action="edit-med" data-id="${esc(m.id)}">Update count</button></div>`);
    }
  }
  return out.join('');
}

function dayTitle(day, now) {
  if (core.sameDay(day, now)) return 'Today';
  if (core.sameDay(day, core.addDays(now, -1))) return 'Yesterday';
  if (core.sameDay(day, core.addDays(now, 1))) return 'Tomorrow';
  return fmt.weekday.format(day);
}

function renderToday() {
  const now = new Date();
  const day = ui.day;
  const isToday = core.sameDay(day, now);
  const isFuture = day > core.startOfDay(now);
  const doses = dosesFor(day, now);
  const taken = doses.filter((d) => d.state === 'taken').length;
  const pct = doses.length ? taken / doses.length : 0;

  const head = `
    <div class="view-head">
      <div><p class="eyebrow">${esc(fmt.long.format(day))}</p><h1>${esc(dayTitle(day, now))}</h1></div>
      <div class="day-bar">
        <button class="icon-btn" data-action="day" data-delta="-1" aria-label="Previous day">‹</button>
        ${isToday ? '' : '<button class="btn btn-small btn-quiet" data-action="day-today">Back to today</button>'}
        <button class="icon-btn" data-action="day" data-delta="1" aria-label="Next day">›</button>
      </div>
    </div>`;

  if (!data.medications.length) {
    return `${head}${banners({ today: isToday })}
      <div class="empty">
        <h2>No medications yet</h2>
        <p>Add what you take, and DoseDay gives you a daily checklist, reminders and a history to share.</p>
        <button class="btn btn-primary" data-action="new-med">Add a medication</button>
      </div>`;
  }

  const circumference = 2 * Math.PI * 40;
  const summary = `
    <section class="summary" aria-label="Progress for this day">
      <div class="ring" aria-hidden="true">
        <svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="40"/><circle class="fill" cx="50" cy="50" r="40" stroke-dasharray="${circumference}" stroke-dashoffset="${circumference * (1 - pct)}"/></svg>
        <span class="pct">${fmt.pct.format(pct)}</span>
      </div>
      <div>
        <h2>${taken} of ${plural(doses.length, 'dose')} taken</h2>
        <p>${esc(summaryDetail(doses, isToday, isFuture))}</p>
      </div>
    </section>`;

  let list = '';
  if (!doses.length) {
    list = `<div class="empty"><h2>Nothing scheduled</h2><p>No doses are due on this day.</p></div>`;
  } else {
    for (const period of PERIODS) {
      const items = doses.filter((d) => PERIODS.find((p) => p.test(core.minutesOf(d.scheduled))) === period);
      if (!items.length) continue;
      list += `<section class="section"><h2>${period.title}</h2><ul class="doses">${items.map((d) => doseRow(d, now, isFuture)).join('')}</ul></section>`;
    }
  }
  return head + banners({ today: isToday }) + summary + list;
}

function summaryDetail(doses, isToday, isFuture) {
  if (!doses.length) return 'Nothing scheduled.';
  if (isFuture) return 'Planned doses for this day.';
  const taken = doses.filter((d) => d.state === 'taken').length;
  if (taken === doses.length) return isToday ? 'All done for today. Nice work.' : 'Every dose was taken.';
  if (isToday) {
    const next = doses.find((d) => d.state === 'due' || d.state === 'upcoming');
    if (next) {
      const when = fmt.time.format(next.scheduled);
      return next.state === 'due' ? `${next.med.name} was due at ${when}.` : `Next up: ${next.med.name} at ${when}.`;
    }
  }
  const missed = doses.filter((d) => d.state === 'missed').length;
  return missed ? `${plural(missed, 'dose')} not logged. You can still record ${missed === 1 ? 'it' : 'them'}.` : 'Everything is logged.';
}

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

function doseRow(d, now, isFuture) {
  const { med, state, scheduled, log } = d;
  const time = fmt.time.format(scheduled);
  let chip;
  if (isFuture) chip = '<span class="chip upcoming">Scheduled</span>';
  else if (state === 'taken') {
    const at = new Date(log.loggedAt);
    const when = core.sameDay(at, scheduled) ? fmt.time.format(at) : `${fmt.dayMonth.format(at)}, ${fmt.time.format(at)}`;
    chip = `<span class="chip taken">Taken ${esc(when)}</span>`;
  } else if (state === 'skipped') chip = '<span class="chip skipped">Skipped</span>';
  else if (state === 'due') chip = `<span class="chip due">${now - scheduled < 3600000 ? 'Due now' : 'Overdue'}</span>`;
  else if (state === 'missed') chip = '<span class="chip missed">Not logged</span>';
  else chip = '<span class="chip upcoming">Coming up</span>';

  const meta = [med.dosage, med.notes].filter(Boolean).map(esc).join(' · ');
  const t = scheduled.getTime();
  const isTaken = state === 'taken';
  const actions = isFuture ? '' : `
    <div class="dose-actions">
      ${state === 'skipped'
        ? `<button class="more" data-action="dose" data-id="${esc(med.id)}" data-t="${t}" data-status="clear">Undo skip</button>`
        : isTaken ? '' : `<button class="more" data-action="dose" data-id="${esc(med.id)}" data-t="${t}" data-status="skipped">Skip</button>`}
      <button class="take" aria-pressed="${isTaken}" data-action="dose" data-id="${esc(med.id)}" data-t="${t}" data-status="${isTaken ? 'clear' : 'taken'}"
        aria-label="${esc(isTaken ? `Undo: ${med.name} at ${time} taken` : `Mark ${med.name} at ${time} as taken`)}">${CHECK}</button>
    </div>`;
  return `
    <li class="dose is-${state}" style="--med: var(--med-${med.color})">
      <span class="dose-time">${esc(time)}</span>
      <div class="dose-main"><span class="dose-name">${esc(med.name)}</span>${meta ? `<span class="dose-meta">${meta}</span>` : ''}${chip}</div>
      ${actions}
    </li>`;
}

function renderMedications() {
  const active = data.medications.filter((m) => m.archivedAt == null).sort((a, b) => a.name.localeCompare(b.name));
  const stopped = data.medications.filter((m) => m.archivedAt != null).sort((a, b) => a.name.localeCompare(b.name));
  const head = `
    <div class="view-head">
      <div><p class="eyebrow">${plural(active.length, 'active medication')}</p><h1>Medications</h1></div>
      <button class="btn btn-primary" data-action="new-med">+ Add medication</button>
    </div>`;
  if (!data.medications.length) {
    return `${head}${banners({})}<div class="empty"><h2>Nothing here yet</h2><p>Add the medications, vitamins or supplements you take.</p><button class="btn btn-primary" data-action="new-med">Add a medication</button></div>`;
  }
  let html = head + banners({});
  if (active.length) html += `<div class="labels">${active.map(label).join('')}</div>`;
  if (stopped.length) html += `<section class="section"><h2>Stopped</h2><div class="labels">${stopped.map(label).join('')}</div></section>`;
  return html;
}

function label(m) {
  const { schedule } = toCore(m);
  const freq = core.frequencyLabel(schedule);
  const days = core.isEveryDay(schedule) ? 'Every day' : weekOrder.filter((w) => schedule.weekdays.includes(w)).map((w) => weekdayName(w)).join(', ');
  const supply = supplyInfo(m);
  const stopped = m.archivedAt != null;
  return `
    <article class="label${stopped ? ' is-archived' : ''}" style="--med: var(--med-${m.color})">
      <div class="label-band"><span>Rx${freq.abbr && !stopped ? ` · ${freq.abbr}` : ''}</span><span>${stopped ? `Stopped ${esc(fmt.full.format(m.archivedAt))}` : `Since ${esc(fmt.full.format(m.startDate))}`}</span></div>
      <div class="label-body">
        <h2 class="label-name">${esc(m.name)}</h2>
        ${m.dosage ? `<p class="label-dose">${esc(m.dosage)}</p>` : ''}
        <div class="sig">
          <span>${esc(freq.text)}</span>
          <span>${schedule.times.map(minutesText).map(esc).join(' · ')}</span>
          <span class="abbr">${esc(days)}</span>
        </div>
        ${m.notes ? `<p class="label-notes">${esc(m.notes)}</p>` : ''}
      </div>
      <div class="label-foot">
        <span class="supply-line${supply?.low ? ' low' : ''}">${supply ? esc(supply.text) : ''}</span>
        <button class="btn btn-small" data-action="edit-med" data-id="${esc(m.id)}" aria-label="Edit ${esc(m.name)}">Edit</button>
      </div>
    </article>`;
}

function historyReport(range, now = new Date()) {
  const meds = coreMeds();
  const days = core.daily(meds, data.logs, range, now);
  const totals = core.total(days);
  const streak = core.currentStreak(core.daily(meds, data.logs, 365, now));
  const start = days[0].day;
  const per = core.perMedication(meds, data.logs, start, core.addDays(now, 1), now);
  const entries = data.medications
    .map((m) => ({ m, stats: per.get(m.id) }))
    .filter((e) => e.stats && core.resolvedCount(e.stats) > 0)
    .sort((a, b) => a.m.name.localeCompare(b.m.name));

  const describe = (s) => {
    const r = core.rateOf(s);
    return r == null ? 'no doses due yet' : `${fmt.pct.format(r)} taken (${s.taken} taken, ${s.skipped} skipped, ${s.missed} not logged)`;
  };
  const lines = [
    'DoseDay medication history',
    `Period: ${fmt.full.format(start)} – ${fmt.full.format(now)}`,
    `Overall: ${describe(totals)}`,
  ];
  for (const { m, stats } of entries) {
    const { schedule } = toCore(m);
    const days2 = core.isEveryDay(schedule) ? 'every day' : weekOrder.filter((w) => schedule.weekdays.includes(w)).map((w) => weekdayName(w)).join(', ');
    lines.push('', `${m.name}${m.dosage ? ` ${m.dosage}` : ''}${m.archivedAt != null ? ' (stopped)' : ''}`,
      `  Schedule: ${schedule.times.map(minutesText).join(', ')}, ${days2}`,
      `  ${describe(stats)}`);
  }
  lines.push('', 'Self-reported with DoseDay.');
  return { days, totals, streak, entries, text: lines.join('\n') };
}

function renderHistory() {
  const head = `
    <div class="view-head">
      <div><p class="eyebrow">How you've been doing</p><h1>History</h1></div>
      <div class="segmented" role="group" aria-label="Period">
        ${[7, 30, 90].map((n) => `<button data-action="range" data-range="${n}" aria-pressed="${ui.range === n}">${n} days</button>`).join('')}
      </div>
    </div>`;
  if (!data.medications.length) {
    return `${head}<div class="empty"><h2>No history yet</h2><p>Your progress appears here once you start logging doses.</p></div>`;
  }
  const r = historyReport(ui.range);
  const rate = core.rateOf(r.totals);
  const scorecard = `
    <section class="scorecard" aria-label="Summary">
      <div class="big-rate">${rate == null ? '<strong>–</strong><span>No doses due yet</span>' : `<strong>${fmt.pct.format(rate)}</strong><span>of doses taken in the last ${ui.range} days</span>`}</div>
      <div class="counts">
        <div class="count" style="--tone: var(--rx)"><b>${r.totals.taken}</b><span>Taken</span></div>
        <div class="count" style="--tone: var(--skip)"><b>${r.totals.skipped}</b><span>Skipped</span></div>
        <div class="count" style="--tone: var(--missed)"><b>${r.totals.missed}</b><span>Not logged</span></div>
        <div class="count" style="--tone: var(--due)"><b>${r.streak}</b><span>${r.streak === 1 ? 'Day' : 'Days'} in a row</span></div>
      </div>
    </section>`;

  const step = ui.range === 7 ? 1 : ui.range === 30 ? 7 : 21;
  const gap = ui.range === 7 ? '10px' : ui.range === 30 ? '3px' : '1px';
  const n = r.days.length;
  const bars = r.days.map((d) => {
    const dr = core.rateOf(d.stats);
    const cls = dr == null ? 'none' : dr < 0.8 ? 'low' : '';
    const title = dr == null ? `${fmt.dayMonth.format(d.day)}: nothing due` : `${fmt.dayMonth.format(d.day)}: ${d.stats.taken} of ${core.resolvedCount(d.stats)} taken`;
    return `<div class="bar ${cls}" title="${esc(title)}"><i style="height:${dr == null ? 0 : Math.max(dr * 100, 1.5)}%"></i></div>`;
  }).join('');
  const xLabels = r.days.map((d, i) => {
    const show = (n - 1 - i) % step === 0;
    const text = ui.range === 7 ? fmt.weekdayShort.format(d.day) : fmt.dayMonth.format(d.day);
    return `<span>${show ? esc(text) : ''}</span>`;
  }).join('');
  const chart = `
    <section class="section">
      <h2>Each day</h2>
      <div class="chart" style="--bar-gap:${gap}" role="img" aria-label="Share of doses taken each day over the last ${ui.range} days">
        <div class="chart-y" aria-hidden="true"><span>100%</span><span>50%</span><span>0%</span></div>
        <div class="chart-plot" aria-hidden="true">${bars}</div>
        <div class="chart-x" aria-hidden="true">${xLabels}</div>
      </div>
      <div class="chart-legend"><span><i style="background: var(--rx)"></i>80% or more taken</span><span><i style="background: var(--due)"></i>Under 80%</span></div>
    </section>`;

  const perMed = r.entries.length ? `
    <section class="section">
      <h2>By medication</h2>
      <ul class="med-rates">${r.entries.map(({ m, stats }) => {
        const mr = core.rateOf(stats);
        return `<li class="med-rate" style="--med: var(--med-${m.color})"><span class="name">${esc(m.name)}</span><span class="pct">${fmt.pct.format(mr)}</span><div class="meter"><i style="width:${mr * 100}%"></i></div><small>${stats.taken} of ${plural(core.resolvedCount(stats), 'dose')} taken</small></li>`;
      }).join('')}</ul>
    </section>` : '';

  const share = `
    <section class="section">
      <h2>Share with your doctor</h2>
      <label class="visually-hidden" for="report">Report text</label>
      <textarea id="report" class="report" readonly>${esc(r.text)}</textarea>
      <div class="row"><button class="btn btn-primary" data-action="copy-report">Copy report</button><button class="btn" data-action="download-report">Download as text file</button></div>
    </section>`;
  return head + scorecard + chart + perMed + share;
}

function reminderStatus() {
  if (!('Notification' in window)) return { text: 'Not supported in this browser', can: false };
  if (Notification.permission === 'granted') return { text: 'On while DoseDay is open', can: true };
  if (Notification.permission === 'denied') return { text: 'Blocked in browser settings', can: false };
  return { text: 'Off', can: false };
}

function renderPreferences() {
  const status = reminderStatus();
  const perm = 'Notification' in window ? Notification.permission : 'unsupported';
  const realMeds = data.medications.filter((m) => m.archivedAt == null).length;
  return `
    <div class="view-head"><div><p class="eyebrow">Reminders, calendar and your data</p><h1>Preferences</h1></div></div>
    ${banners({})}
    <section class="pref" aria-labelledby="p-rem">
      <h2 id="p-rem">Reminders in this browser</h2>
      <p class="status">Status: ${esc(status.text)}</p>
      <p>Browsers can only show reminders while DoseDay is open in a tab. To be reminded when it's closed, add your schedule to your calendar below.</p>
      <div class="row">
        ${perm === 'default' ? '<button class="btn btn-primary" data-action="enable-reminders">Turn on reminders</button>' : ''}
        ${perm === 'granted' ? '<button class="btn" data-action="test-reminder">Send a test reminder</button>' : ''}
        ${perm === 'denied' ? '<p>To turn them on, allow notifications for this site in your browser settings, then reload the page.</p>' : ''}
      </div>
      <label class="check" for="p-hide"><input id="p-hide" type="checkbox" data-action="hide-names" ${data.settings.hideNames ? 'checked' : ''}> Hide medication names in reminders and calendar events</label>
    </section>

    <section class="pref" aria-labelledby="p-cal">
      <h2 id="p-cal">Add reminders to your calendar</h2>
      <p>Download a calendar file with an alert at every dose time. Open it with Apple Calendar, Google Calendar or Outlook, and your phone reminds you even when DoseDay is closed. Download it again after changing your medications.</p>
      <div class="row"><button class="btn btn-primary" data-action="download-ics" ${realMeds ? '' : 'disabled'}>Download calendar file (.ics)</button></div>
    </section>

    <section class="pref" aria-labelledby="p-data">
      <h2 id="p-data">Your data</h2>
      <p>Everything is stored only in this browser on this device. Nothing is sent anywhere. Clearing your browser's site data erases it, so download a backup now and then. A backup also moves your data to another device.</p>
      <div class="row">
        <button class="btn" data-action="export">Download backup</button>
        <button class="btn" data-action="pick-import">Restore from backup…</button>
        <input id="p-import" type="file" accept="application/json,.json" hidden data-action="import">
      </div>
      ${ui.pendingImport ? `
        <div class="confirm">
          <p>Replace everything here with the backup (${plural(ui.pendingImport.medications.length, 'medication')}, ${plural(ui.pendingImport.logs.length, 'logged dose')})?</p>
          <div class="row"><button class="btn btn-danger" data-action="confirm-import">Replace my data</button><button class="btn btn-quiet" data-action="cancel-import">Cancel</button></div>
        </div>` : ''}
      <div class="danger-zone">
        <button class="btn btn-danger-quiet" data-action="ask-wipe">Delete all my data…</button>
        ${ui.confirmWipe ? `
          <div class="confirm">
            <p>This permanently deletes every medication and all history from this browser.</p>
            <div class="row"><button class="btn btn-danger" data-action="confirm-wipe">Delete everything</button><button class="btn btn-quiet" data-action="cancel-wipe">Keep my data</button></div>
          </div>` : ''}
      </div>
    </section>

    <section class="pref" aria-labelledby="p-about">
      <h2 id="p-about">About DoseDay</h2>
      <p>DoseDay is free and has no accounts, ads or tracking. It helps you remember doses and keep a record. It doesn't check doses or interactions, so ask your pharmacist if you're unsure about a medication.</p>
    </section>`;
}

function updateTitle() {
  const due = dosesFor(new Date()).filter((d) => d.state === 'due').length;
  document.title = due ? `(${due}) DoseDay` : 'DoseDay';
}

// ---------------------------------------------------------------- toasts

const toasts = $('#toasts');

function showToast({ key = uid(), text, actions = [], kind = '', timeout = 4500 }) {
  removeToast(key);
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.dataset.key = key;
  el.setAttribute('role', kind === 'reminder' ? 'alert' : 'status');
  el.innerHTML = `<p>${esc(text)}</p>${actions.length ? `<div class="row">${actions.map((a, i) => `<button class="btn btn-small${a.primary ? ' btn-primary' : ''}" data-i="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}`;
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    actions[Number(b.dataset.i)].onClick?.();
    el.remove();
  });
  toasts.append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

function removeToast(key) {
  for (const el of toasts.querySelectorAll('.toast')) if (el.dataset.key === key) el.remove();
}

// ---------------------------------------------------------------- reminders

const notified = new Set();
const snoozed = new Map(); // dose key -> time to remind again (ms)

function reminderText(med) {
  if (data.settings.hideNames) return { title: 'Medication reminder', body: "It's time for a scheduled dose." };
  return { title: `Time for ${med.name}`, body: med.dosage ? `Take ${med.dosage}.` : "It's time for your dose." };
}

function remind(dose) {
  const key = core.doseKey(dose.medId, dose.scheduled);
  const med = byId(dose.medId);
  if (!med) return;
  const { title, body } = reminderText(med);
  const t = dose.scheduled.getTime();
  showToast({
    key,
    kind: 'reminder',
    timeout: 0,
    text: `${title} (${fmt.time.format(dose.scheduled)}). ${body}`,
    actions: [
      { label: 'Taken', primary: true, onClick: () => setDose(med.id, t, 'taken') },
      { label: `In ${SNOOZE_MINUTES} min`, onClick: () => snoozed.set(key, Date.now() + SNOOZE_MINUTES * 60000) },
      { label: 'Dismiss' },
    ],
  });
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body: `${body} Scheduled for ${fmt.time.format(dose.scheduled)}.`, tag: key, requireInteraction: true });
      n.onclick = () => { window.focus(); n.close(); };
    }
  } catch { /* some browsers only allow notifications from a service worker */ }
}

let lastSignature = '';
function signature() {
  return dosesFor(new Date()).map((d) => d.state).join(',') + (core.sameDay(ui.day, new Date()) ? '' : 'x');
}

function tick() {
  const now = new Date();
  if (ui.followToday && !core.sameDay(ui.day, now)) ui.day = core.startOfDay(now);

  const windowStart = new Date(now.getTime() - REMIND_WINDOW_MINUTES * 60000);
  for (const dose of core.evaluate(coreMeds(), data.logs, windowStart, new Date(now.getTime() + 1), now)) {
    const key = core.doseKey(dose.medId, dose.scheduled);
    if (dose.state === 'due' && !notified.has(key)) {
      notified.add(key);
      remind(dose);
    }
  }
  for (const [key, until] of snoozed) {
    if (until > now.getTime()) continue;
    snoozed.delete(key);
    const [medId, t] = [key.slice(0, key.lastIndexOf('@')), Number(key.slice(key.lastIndexOf('@') + 1))];
    if (!findLog(medId, t)) remind({ medId, scheduled: new Date(t) });
  }
  // Re-render only when a dose changed state, so typing and focus aren't disturbed.
  if (signature() !== lastSignature && !$('#editor').open) render();
  else updateTitle();
}

// Don't pop reminders for doses that were already overdue when the page opened.
for (const dose of core.evaluate(coreMeds(), data.logs, new Date(Date.now() - REMIND_WINDOW_MINUTES * 60000), new Date(), new Date())) {
  if (Date.now() - dose.scheduled > 2 * 60000) notified.add(core.doseKey(dose.medId, dose.scheduled));
}

async function enableReminders() {
  if (!('Notification' in window)) {
    showToast({ text: "This browser doesn't support notifications. Use the calendar file in Preferences instead." });
    return;
  }
  try {
    const result = await Notification.requestPermission();
    showToast({ text: result === 'granted' ? 'Reminders are on while DoseDay is open.' : 'Reminders stay off. You can still use the calendar file in Preferences.' });
  } catch {
    showToast({ text: "Reminders couldn't be turned on here. Use the calendar file in Preferences instead." });
  }
  render();
}

// ---------------------------------------------------------------- downloads & copy

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function copyReport() {
  const area = $('#report');
  try {
    await navigator.clipboard.writeText(area.value);
    showToast({ text: 'Report copied. Paste it into an email or message.' });
  } catch {
    area.focus();
    area.select();
    showToast({ text: 'Report selected. Press Ctrl+C (or ⌘C) to copy it.' });
  }
}

// ---------------------------------------------------------------- editor

const dialog = $('#editor');
const form = $('#editor-form');
let editingId = null;

function timeRow(minutes) {
  const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const n = $('#f-times').children.length + 1;
  const li = document.createElement('li');
  li.innerHTML = `<input type="time" value="${value}" required aria-label="Dose time ${n}"><button type="button" class="icon-btn" data-action="remove-time" aria-label="Remove this time">✕</button>`;
  return li;
}

function readTimes() {
  return [...$('#f-times').querySelectorAll('input')]
    .map((i) => /^(\d{2}):(\d{2})/.exec(i.value))
    .filter(Boolean)
    .map((m) => Number(m[1]) * 60 + Number(m[2]));
}

function openEditor(id = null) {
  editingId = id;
  const m = id ? byId(id) : null;
  $('#editor-title').textContent = m ? `Edit ${m.name}` : 'New medication';
  form.reset();
  $('#f-error').hidden = true;
  $('#f-confirm').hidden = true;
  $('#f-name').value = m?.name ?? '';
  $('#f-dosage').value = m?.dosage ?? '';
  $('#f-notes').value = m?.notes ?? '';

  const color = m?.color ?? COLORS[(data.sample ? 0 : data.medications.length) % COLORS.length];
  $('#f-colors').innerHTML = COLORS.map((c) => `
    <label class="swatch" style="--med: var(--med-${c})"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''} aria-label="${c[0].toUpperCase() + c.slice(1)}"><span></span></label>`).join('');

  const times = $('#f-times');
  times.innerHTML = '';
  for (const t of m?.times ?? [480]) times.append(timeRow(t));

  const weekly = m && m.weekdays.length > 0 && m.weekdays.length < 7;
  $('#f-repeat').value = weekly ? 'weekly' : 'daily';
  $('#f-days').innerHTML = weekOrder.map((w) => `
    <label class="day-pick"><input type="checkbox" name="day" value="${w}" ${!weekly || m.weekdays.includes(w) ? 'checked' : ''} aria-label="${esc(weekdayName(w, 'weekday'))}"><span aria-hidden="true">${esc(weekdayName(w).slice(0, 2))}</span></label>`).join('');
  $('#f-days-wrap').hidden = !weekly;

  const start = new Date(m?.startDate ?? Date.now());
  $('#f-start').value = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;

  $('#f-track').checked = Boolean(m?.tracksSupply);
  $('#f-left').value = m?.tracksSupply ? m.supply : 30;
  $('#f-per').value = m?.perDose ?? 1;
  $('#f-warn').value = m?.refillDays ?? 7;
  $('#f-supply').hidden = !$('#f-track').checked;

  $('#f-edit-only').hidden = !m;
  $('#f-archived').checked = m?.archivedAt != null;

  dialog.showModal();
  if (!m) $('#f-name').focus();
}

function closeEditor() {
  dialog.close();
  editingId = null;
}

function formError(message) {
  const el = $('#f-error');
  el.textContent = message;
  el.hidden = false;
}

function saveEditor() {
  const name = $('#f-name').value.trim();
  const times = core.makeSchedule({ times: readTimes(), startDate: 0 }).times;
  const weekly = $('#f-repeat').value === 'weekly';
  const weekdays = weekly ? [...form.querySelectorAll('input[name="day"]:checked')].map((i) => Number(i.value)) : [];
  const startMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('#f-start').value);
  if (!name) { formError('Enter the medication name.'); $('#f-name').focus(); return; }
  if (!times.length) { formError('Add at least one dose time.'); return; }
  if (weekly && !weekdays.length) { formError('Choose at least one day.'); return; }
  if (!startMatch) { formError('Enter a start date.'); $('#f-start').focus(); return; }
  const startDate = new Date(Number(startMatch[1]), Number(startMatch[2]) - 1, Number(startMatch[3])).getTime();
  const tracksSupply = $('#f-track').checked;
  const int = (sel, min, fallback) => { const v = Math.floor(Number($(sel).value)); return Number.isFinite(v) ? Math.max(min, v) : fallback; };

  const now = new Date();
  const todayStart = core.startOfDay(now).getTime();
  let med = editingId ? byId(editingId) : null;
  const isNew = !med;
  if (isNew) {
    if (data.sample) {
      clearSamples();
      showToast({ text: 'Sample medications removed. This is your own list now.' });
    }
    med = { id: uid(), createdAt: Date.now(), archivedAt: null, supply: 0 };
    data.medications.push(med);
  }
  const normalizedDays = weekdays.length === 7 ? [] : core.makeSchedule({ weekdays, startDate: 0 }).weekdays;
  const scheduleChanged = !isNew && (med.times.join() !== times.join() || med.weekdays.join() !== normalizedDays.join());
  const archived = $('#f-archived').checked && !isNew;
  const unarchived = !isNew && med.archivedAt != null && !archived;

  Object.assign(med, {
    name,
    dosage: $('#f-dosage').value.trim(),
    notes: $('#f-notes').value.trim(),
    color: form.querySelector('input[name="color"]:checked')?.value ?? 'green',
    times,
    weekdays: normalizedDays,
    tracksSupply,
    supply: tracksSupply ? int('#f-left', 0, 0) : med.supply ?? 0,
    perDose: int('#f-per', 1, 1),
    refillDays: int('#f-warn', 0, 7),
  });
  // Past days were tracked against the old schedule, so a changed schedule
  // starts today instead of re-judging history. Logged doses are kept.
  med.startDate = !isNew && (scheduleChanged || unarchived) && startDate < todayStart ? todayStart : startDate;
  if (archived && med.archivedAt == null) med.archivedAt = Date.now();
  if (!archived) med.archivedAt = null;

  save();
  closeEditor();
  render();
  showToast({ text: isNew ? `${name} added.` : `${name} saved.` });
}

function deleteEditing() {
  const med = byId(editingId);
  if (!med) return;
  data.medications = data.medications.filter((m) => m !== med);
  data.logs = data.logs.filter((l) => l.medId !== med.id);
  save();
  closeEditor();
  render();
  showToast({ text: `${med.name} and its history were deleted.` });
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  saveEditor();
});
form.addEventListener('change', (e) => {
  if (e.target.id === 'f-repeat') $('#f-days-wrap').hidden = e.target.value !== 'weekly';
  if (e.target.id === 'f-track') $('#f-supply').hidden = !e.target.checked;
});
dialog.addEventListener('close', () => { editingId = null; });

// ---------------------------------------------------------------- events

document.addEventListener('click', (e) => {
  const tab = e.target.closest('a[data-tab], a.brand');
  if (tab) {
    e.preventDefault();
    go(tab.dataset.tab ?? 'today');
    if (!tab.dataset.tab) { ui.day = core.startOfDay(new Date()); ui.followToday = true; render(); }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const action = el.dataset.action;
  switch (action) {
    case 'day': {
      ui.day = core.addDays(ui.day, Number(el.dataset.delta));
      ui.followToday = core.sameDay(ui.day, new Date());
      render();
      break;
    }
    case 'day-today':
      ui.day = core.startOfDay(new Date());
      ui.followToday = true;
      render();
      break;
    case 'dose': {
      const status = el.dataset.status === 'clear' ? null : el.dataset.status;
      setDose(el.dataset.id, Number(el.dataset.t), status);
      // The list re-rendered; keep keyboard focus on the same dose.
      main.querySelector(`.take[data-id="${CSS.escape(el.dataset.id)}"][data-t="${el.dataset.t}"]`)?.focus();
      break;
    }
    case 'new-med': openEditor(null); break;
    case 'edit-med': openEditor(el.dataset.id); break;
    case 'close-editor': closeEditor(); break;
    case 'add-time': {
      const existing = readTimes();
      let next = ((existing.length ? Math.max(...existing) : 240) + 240) % core.MINUTES_PER_DAY;
      while (existing.includes(next)) next = (next + 30) % core.MINUTES_PER_DAY;
      const row = timeRow(next);
      $('#f-times').append(row);
      row.querySelector('input').focus();
      break;
    }
    case 'remove-time':
      if ($('#f-times').children.length > 1) el.closest('li').remove();
      else formError('A medication needs at least one dose time.');
      break;
    case 'ask-delete': $('#f-confirm').hidden = false; $('#f-confirm button').focus(); break;
    case 'cancel-delete': $('#f-confirm').hidden = true; break;
    case 'confirm-delete': deleteEditing(); break;
    case 'clear-samples':
      clearSamples();
      render();
      showToast({ text: 'Samples cleared. Add your first medication to get started.' });
      break;
    case 'enable-reminders': enableReminders(); break;
    case 'dismiss-reminders':
      data.settings.reminderPromptDismissed = true;
      save();
      render();
      break;
    case 'test-reminder': {
      const med = data.medications.find((m) => m.archivedAt == null) ?? { name: 'Example', dosage: '1 tablet', id: 'test' };
      try {
        const { title, body } = reminderText(med);
        new Notification(title, { body, tag: 'doseday-test' });
        showToast({ text: 'Test reminder sent.' });
      } catch {
        showToast({ text: "Your browser didn't show the test reminder. Check its notification settings." });
      }
      break;
    }
    case 'range': ui.range = Number(el.dataset.range); render(); break;
    case 'copy-report': copyReport(); break;
    case 'download-report': download(`doseday-history-${today()}.txt`, historyReport(ui.range).text, 'text/plain;charset=utf-8'); break;
    case 'download-ics':
      download('doseday-reminders.ics', core.buildCalendar(coreMeds().filter((m) => byId(m.id).archivedAt == null), { hideNames: data.settings.hideNames }), 'text/calendar;charset=utf-8');
      showToast({ text: 'Calendar file downloaded. Open it to add the reminders to your calendar.' });
      break;
    case 'export': {
      const { sample, ...rest } = data;
      download(`doseday-backup-${today()}.json`, JSON.stringify({ ...rest, sample, exportedAt: new Date().toISOString() }, null, 2), 'application/json');
      break;
    }
    case 'confirm-import':
      data = ui.pendingImport;
      ui.pendingImport = null;
      save();
      render();
      showToast({ text: `Restored ${plural(data.medications.length, 'medication')}.` });
      break;
    case 'pick-import': $('#p-import').click(); break;
    case 'cancel-import': ui.pendingImport = null; render(); break;
    case 'ask-wipe': ui.confirmWipe = true; render(); break;
    case 'cancel-wipe': ui.confirmWipe = false; render(); break;
    case 'confirm-wipe':
      data = blankData();
      ui.confirmWipe = false;
      save();
      render();
      showToast({ text: 'All data deleted.' });
      break;
    default: break;
  }
});

document.addEventListener('change', async (e) => {
  const el = e.target;
  if (el.dataset?.action === 'hide-names') {
    data.settings.hideNames = el.checked;
    save();
  }
  if (el.dataset?.action === 'import' && el.files?.[0]) {
    try {
      const parsed = normalize(JSON.parse(await el.files[0].text()));
      if (!parsed) throw new Error('bad file');
      ui.pendingImport = parsed;
    } catch {
      showToast({ text: "That file isn't a DoseDay backup. Choose a .json file made with “Download backup”." });
    }
    el.value = '';
    render();
  }
});

window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS.includes(v) && v !== ui.view) go(v);
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
setInterval(tick, 20000);

render();
