# DoseDay

A free, private medication reminder and tracker that runs in any web browser. There's no account and no server: your data stays in your browser.

## The problem

About half of people on long-term medication don't take it as prescribed. Missed doses are a major cause of avoidable hospital visits, especially for chronic conditions like diabetes, high blood pressure and heart disease. The usual causes are simple: people forget, lose track of whether they already took a dose, or run out before refilling. Many tools that help need an account or collect health data.

| Problem | What DoseDay does |
| --- | --- |
| Forgetting a dose | A reminder at each dose time while the site is open, plus a calendar file that puts repeating alerts in your phone's calendar so you get them even when the site is closed |
| "Did I already take it?" | A daily checklist showing what's taken, skipped, overdue or coming up. You can also go back and record doses for earlier days |
| Running out | An optional count of what's left that goes down as you log doses, with a warning a set number of days before you run out |
| Telling your doctor how it's going | History for 7, 30 or 90 days, a streak, rates for each medication, and a plain-text report to copy or download |
| Privacy | Data stays in your browser. You can hide medication names in reminders. Back up and restore with a file |

## Using it

It's a static site with no build step. Serve the `web/` folder from any static host, such as GitHub Pages, Netlify or Cloudflare Pages, or run it locally:

```sh
cd web
npm start            # http://127.0.0.1:8080
```

It has to be served over http(s), because opening `index.html` straight from disk blocks the JavaScript modules.

On a first visit DoseDay shows three sample medications, clearly labelled, so people can see how it works. They disappear as soon as you add your own medication or press "Clear samples".

### What browsers can and can't do

- **Reminders** show as notifications, plus an in-page alert with Taken and Snooze buttons. They only work while DoseDay is open in a tab, because browsers don't let a website schedule alerts after it's closed without a push server. For reminders when it's closed, use **Preferences → Download calendar file**: every dose time becomes a repeating calendar event with an alert.
- **Data** lives in the browser's local storage on that device. Clearing site data erases it, so Preferences has **Download backup** and **Restore from backup**, which also move data between devices.

## Tests

```sh
cd web
npm test             # scheduling, adherence, reminders, refills, calendar file (Node's test runner)
npm run test:e2e     # drives the real site in Chromium (needs: npm i --no-save playwright)
```

The browser tests fix the clock and time zone, then check adding, taking, undoing and skipping doses, persistence across reloads, refill counts and warnings, reminders, history, calendar and backup downloads, schedule edits that keep history, deletion, and that phone-width layouts never scroll sideways in light or dark mode. CI runs both on every change under `web/`.

## Files

```
web/
  index.html     Page shell and the medication editor dialog
  styles.css     Design tokens (light and dark) and layout
  core.js        Pure logic: schedules, dose states, adherence, reminders, refills, .ics export
  app.js         Storage, rendering, reminders, editor, downloads
  tests/         core.test.js (unit), e2e.js (browser), serve.js (local server)
```

DoseDay is a tracking aid, not medical advice.
