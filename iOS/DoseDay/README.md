# DoseDay

A private, offline medication reminder and tracker for iPhone and iPad.

## The problem

About half of people on long-term medication don't take it as prescribed. Missed doses are a major cause of avoidable hospital visits, especially for chronic conditions like diabetes, high blood pressure, and heart disease. The usual causes are simple: people forget, lose track of whether they already took a dose, or run out before refilling. Many apps that help are cluttered, require an account, or collect health data.

DoseDay addresses those causes:

| Problem | What DoseDay does |
| --- | --- |
| Forgetting a dose | A reminder at each dose time, with **Mark as Taken** and **Remind Me in 10 Minutes** actions right on the notification |
| "Did I already take it?" | A daily checklist showing what's taken, skipped, overdue, or coming up |
| Running out | Optional pill/dose count that goes down as you log, with a refill warning a set number of days before you run out |
| Telling your doctor how it's going | Adherence history (7/30/90 days), a streak, per-medication rates, and a plain-text report to share |
| Privacy | No account, no server, no analytics. Data stays on the device. You can hide medication names on the Lock Screen |

## Features

- Any number of medications, each with several times per day and either every day or specific weekdays
- Reminders only for doses not yet logged: taking one early cancels its reminder
- Log doses from the app or from the notification, including past days you forgot to record
- Undo, skip, and archive (stops reminders, keeps history) or delete
- Schedule edits apply from today, so past history isn't re-judged against the new schedule
- Correct wall-clock times across daylight-saving changes
- Dynamic Type, VoiceOver labels, Dark Mode, haptics
- Plain-language disclaimer: DoseDay is a tracking aid, not medical advice

## Running it

Requirements: **Xcode 16 or later**, iOS 17+ deployment target.

1. Open `iOS/DoseDay/DoseDay.xcodeproj`.
2. Select the **DoseDay** target → *Signing & Capabilities* → choose your Team. Change the bundle identifier if needed (default `com.rhjoy2.DoseDay`).
3. Pick a simulator or your iPhone and press **Run** (⌘R).

Run the tests with **⌘U**, or run only the scheduling and statistics logic, without a simulator, on macOS or Linux:

```sh
cd iOS/DoseDay
swift test
```

CI (`.github/workflows/ios.yml`) runs both: `swift test` on Linux, and `xcodebuild test` on an iOS Simulator.

## How it's built

SwiftUI + SwiftData + UserNotifications + Swift Charts. No third-party dependencies.

```
DoseDay/
  Core/        Pure Swift scheduling, adherence, reminder-planning and supply logic (unit-tested)
  Models/      SwiftData models: Medication, DoseLog
  Services/    Persistence, dose logging, notification scheduling and actions
  Views/       Today, Medications, editor, History, Settings, onboarding
DoseDayTests/  Unit tests for Core
```

**Reminders:** iOS allows 64 pending local notifications per app. Instead of repeating notifications, which would still fire for doses you've already taken, DoseDay schedules one-off reminders for the next 60 unlogged doses within 14 days. It rebuilds that list whenever data changes or the app opens. If someone takes several medications many times a day and doesn't open the app for over a week, the furthest-out reminders can run out. Opening the app, or marking a dose as taken from a reminder, tops them up.
