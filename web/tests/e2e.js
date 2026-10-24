// Browser tests: drives the real site in Chromium with a fixed clock.
// Run with `npm run test:e2e` (needs the `playwright` package and Chromium).
// Set SCREENSHOTS=<dir> to also save screenshots of each view.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { serve } from './serve.js';

async function loadPlaywright() {
  try {
    return await import('playwright');
  } catch {
    // Fall back to a globally installed copy (e.g. NODE_PATH or `npm root -g`).
    const { execSync } = await import('node:child_process');
    const globalRoot = execSync('npm root -g').toString().trim();
    return createRequire(`${globalRoot}/`)('playwright');
  }
}

const { chromium } = await loadPlaywright();
const server = await serve(0);
const base = `http://127.0.0.1:${server.address().port}/`;
const shots = process.env.SCREENSHOTS;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let passed = 0;

async function newPage({ width = 1100, height = 900, scheme = 'light', time = '2026-10-21T09:30:00-04:00' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme, timezoneId: 'America/New_York', locale: 'en-US', acceptDownloads: true });
  await context.grantPermissions(['notifications'], { origin: base.slice(0, -1) });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(`console: ${m.text()}`); });
  await page.clock.install({ time: new Date(time) });
  await page.goto(base);
  await page.waitForSelector('.view-head');
  return { page, context };
}

async function step(name, fn) {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

async function noHorizontalScroll(page, label) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  assert.ok(sw <= cw, `${label}: page scrolls sideways (${sw} > ${cw})`);
}

try {
  const { page, context } = await newPage();

  await step('first visit shows labelled sample medications', async () => {
    await page.getByText('These are sample medications').waitFor();
    assert.equal(await page.locator('h1').textContent(), 'Today');
    assert.ok(await page.locator('.dose').count() >= 3);
    if (shots) await page.screenshot({ path: `${shots}/today-desktop.png`, fullPage: true });
  });

  await step('sample medications can be cleared', async () => {
    await page.getByRole('button', { name: 'Clear samples' }).click();
    await page.getByText('No medications yet').waitFor();
  });

  await step('adding a medication validates and saves', async () => {
    await page.getByRole('button', { name: 'Add a medication' }).click();
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Enter the medication name.').waitFor();
    await page.fill('#f-name', 'Amoxicillin');
    await page.fill('#f-dosage', '250 mg capsule');
    await page.getByRole('button', { name: '+ Add a time' }).click();
    const times = page.locator('#f-times input');
    await times.nth(0).fill('08:00');
    await times.nth(1).fill('20:00');
    await page.check('#f-track');
    await page.fill('#f-left', '10');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByText('Amoxicillin added.').waitFor();
    assert.equal(await page.locator('.dose').count(), 2);
    assert.match(await page.locator('.dose').first().textContent(), /Overdue/);
    assert.match(await page.locator('.summary h2').textContent(), /0 of 2 doses taken/);
  });

  await step('taking, undoing and skipping a dose', async () => {
    await page.getByRole('button', { name: /Mark Amoxicillin at 8:00 AM as taken/ }).click();
    assert.match(await page.locator('.summary h2').textContent(), /1 of 2 doses taken/);
    assert.match(await page.locator('.dose').first().textContent(), /Taken 9:30/);
    await page.getByRole('button', { name: /Undo: Amoxicillin at 8:00 AM taken/ }).click();
    assert.match(await page.locator('.summary h2').textContent(), /0 of 2 doses taken/);
    await page.locator('.dose').first().getByRole('button', { name: 'Skip' }).click();
    assert.match(await page.locator('.dose').first().textContent(), /Skipped/);
    await page.locator('.dose').first().getByRole('button', { name: 'Undo skip' }).click();
    await page.getByRole('button', { name: /Mark Amoxicillin at 8:00 AM as taken/ }).click();
  });

  await step('data survives a reload', async () => {
    await page.reload();
    await page.waitForSelector('.dose');
    assert.match(await page.locator('.summary h2').textContent(), /1 of 2 doses taken/);
  });

  await step('supply count goes down when a dose is taken', async () => {
    await page.getByRole('link', { name: 'Medications', exact: true }).click();
    await page.locator('.label').first().waitFor();
    const text = await page.locator('.label').first().textContent();
    assert.match(text, /BID/);
    assert.match(text, /9 doses left, about 4 days/);
    if (shots) await page.screenshot({ path: `${shots}/medications.png`, fullPage: true });
  });

  await step('refill warning appears on Today', async () => {
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    await page.getByText('Refill Amoxicillin soon.').waitFor();
  });

  await step('a reminder pops up when a dose comes due', async () => {
    await page.clock.fastForward('10:30:30'); // to 20:00:30
    await page.locator('.toast.reminder').waitFor({ timeout: 5000 });
    assert.match(await page.locator('.toast.reminder').textContent(), /Time for Amoxicillin \(8:00 PM\)/);
    assert.equal(await page.title(), '(1) DoseDay');
    await page.locator('.toast.reminder').getByRole('button', { name: 'Taken' }).click();
    assert.match(await page.locator('.summary h2').textContent(), /2 of 2 doses taken/);
    assert.equal(await page.title(), 'DoseDay');
  });

  await step('history shows the rate, chart and a shareable report', async () => {
    await page.getByRole('link', { name: 'History', exact: true }).click();
    await page.locator('.scorecard').waitFor();
    assert.equal(await page.locator('.bar').count(), 7);
    assert.match(await page.locator('.big-rate').textContent(), /100%/);
    assert.match(await page.locator('#report').inputValue(), /Amoxicillin 250 mg capsule[\s\S]*100% taken \(2 taken/);
    await page.getByRole('button', { name: '30 days' }).click();
    assert.equal(await page.locator('.bar').count(), 30);
    if (shots) await page.screenshot({ path: `${shots}/history.png`, fullPage: true });
  });

  await step('calendar file and backup download', async () => {
    await page.getByRole('link', { name: 'Preferences', exact: true }).click();
    const [ics] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download calendar file/ }).click()]);
    const icsText = await (await import('node:fs/promises')).readFile(await ics.path(), 'utf8');
    assert.equal(icsText.match(/BEGIN:VEVENT/g).length, 2);
    assert.match(icsText, /SUMMARY:Take Amoxicillin \(250 mg capsule\)/);
    const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download backup' }).click()]);
    const json = JSON.parse(await (await import('node:fs/promises')).readFile(await backup.path(), 'utf8'));
    assert.equal(json.medications.length, 1);
    assert.equal(json.logs.length, 2);
  });

  await step('editing a schedule keeps logged history', async () => {
    await page.getByRole('link', { name: 'Medications', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Amoxicillin' }).click();
    await page.locator('#f-times input').nth(1).fill('21:00');
    await page.getByRole('button', { name: 'Save' }).click();
    await page.getByRole('link', { name: 'Today', exact: true }).click();
    // The 8 PM dose is logged, so it stays alongside the new 9 PM time.
    assert.equal(await page.locator('.dose').count(), 3);
  });

  await step('deleting asks for confirmation inside the dialog', async () => {
    await page.getByRole('link', { name: 'Medications', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Amoxicillin' }).click();
    await page.getByRole('button', { name: 'Delete medication…' }).click();
    await page.getByRole('button', { name: 'Delete medication and history' }).click();
    await page.getByText('Nothing here yet').waitFor();
  });

  await context.close();

  await step('phone width in light and dark: no sideways scrolling on any view', async () => {
    for (const scheme of ['light', 'dark']) {
      const { page: p, context: c } = await newPage({ width: 390, height: 844, scheme });
      for (const view of ['Today', 'Medications', 'History', 'Preferences']) {
        await p.getByRole('link', { name: view, exact: true }).click();
        await p.waitForSelector('.view-head');
        await noHorizontalScroll(p, `${scheme} ${view}`);
        if (shots) await p.screenshot({ path: `${shots}/phone-${scheme}-${view.toLowerCase()}.png`, fullPage: true });
      }
      await p.getByRole('link', { name: 'Medications', exact: true }).click();
      await p.getByRole('button', { name: '+ Add medication' }).click();
      await noHorizontalScroll(p, `${scheme} editor`);
      if (shots) await p.screenshot({ path: `${shots}/phone-${scheme}-editor.png` });
      await c.close();
    }
  });

  assert.deepEqual(errors, [], 'no script errors');
  console.log(`\n${passed} browser checks passed`);
} catch (err) {
  console.error(err);
  if (errors.length) console.error(errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
