# 🗓️ My Calendar for Joplin

[![Joplin Plugin](https://img.shields.io/badge/Joplin-Plugin-blue)](https://joplinapp.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**My Calendar** is a powerful, flexible, and privacy-focused calendar plugin for [Joplin](https://joplinapp.org/). It
turns your notes into calendar events, providing a unified view of your schedule directly within your favorite
note-taking app.

---

## 🌟 Key Features

- **Monthly Calendar Grid**: Navigate through months, view event bars, and see your schedule at a glance.
- **Smart Day View**: Click any day to see a detailed list of scheduled events.
- **Notes as Events**: Any note can become a calendar event simply by adding a small Markdown block.
- **ICS Import**: Import standard `*.ics` files (from Google Calendar, Outlook, Apple, etc.) directly into your Joplin
  notebooks.
- **Automatic Alarms**: The plugin automatically creates "Todo" notes with reminders based on your calendar alarms (
  `VALARM`).
- **Recurrence Support**: Full support for daily, weekly, monthly, and yearly recurring events.
- **High Security**: Built-in protection against Markdown and CSS injections.
- **Universal Sync**: Works with Joplin's built-in synchronization across all your devices.

---

## 🚀 Getting Started

### 1. Installation

1. Open **Joplin Desktop**.
2. Go to `Tools` > `Options` (Windows/Linux) or `Joplin` > `Settings` (macOS).
3. Select `Plugins` and search for `My Calendar`.
4. Click **Install** and restart Joplin.

### 2. Manual Event Creation

You don't need to import files to use the calendar. Simply add the following block to any note:

~~~markdown
```mycalendar-event
title: Meeting with Team
start: 2025-12-18 10:00+02:00
end: 2025-12-18 11:30+02:00
color: #3498db
location: Conference Room B
```
~~~

The note will immediately appear on your calendar!

---

## 📥 ICS Import System

The plugin features a robust import system designed for performance and reliability.

### How to Import:

1. Open the **My Calendar** panel.
2. Select the **Target Notebook** where you want your events to be stored.
3. Choose your `*.ics` file and click **Import**.

### Smart Features:

- **Deduplication**: The plugin uses `UID`s from the ICS file. If you import the same file again, it will only update
  changed events or skip unchanged ones.
- **Local Color Preservation**: By default, if you manually change the color of an imported event in Joplin, subsequent
  imports will preserve your custom color.
- **Automatic Alarms**: If an ICS event has a reminder, the plugin creates a linked "Todo" note in Joplin. These todos
  appear in your standard Joplin tasks and trigger native notifications.

---

## 🛠️ Advanced Syntax

Below is the full list of properties supported inside the ` ```mycalendar-event ` block:

| Property | Status | Description | Example |
| :--- | :--- | :--- | :--- |
| `start` | **Required** | Start date and time. Mandatory for the event to appear. | `2025-12-18 10:00+02:00` |
| `title` | Optional | Display name. If omitted, the **Joplin note title** will be used. | `Meeting` |
| `end` | Optional | End date and time. If omitted, the event is treated as a point in time (0 duration). | `2025-12-18 11:30+02:00` |
| `tz` | Optional | Timezone (IANA). | `America/Toronto` |
| `color` | Optional | Hex color for the event bar. | `#e74c3c` |
| `location` | Optional | Location string. | `Home Office` |
| `description` | Optional | Extra details (auto-sanitized). | `Check project status.` |
| `repeat` | Optional | `daily`, `weekly`, `monthly`, `yearly` | `weekly` |
| `repeat_interval`| Optional | Frequency (e.g., every 2 weeks). | `2` |
| `byweekday` | Optional | Specific days for weekly repeat. | `MO,WE,FR` |
| `bymonthday` | Optional | Day of the month for monthly repeat. | `15` |
| `all_day` | Optional | Set to `true` for all-day events. | `true` |

### 🕒 Supported Time & Timezone Formats

The calendar supports several ways to specify the time and timezone of your events:

1. **With UTC Offset (Recommended)**
   Explicitly define the time and its relation to UTC. This time will be automatically converted to your current
   device's timezone.
   ```text
   start: 2025-12-18 10:00+02:00
   ```

2. **With `tz` Property (IANA)**
   Specify the time and the exact IANA Timezone name. The plugin will handle the conversion based on daylight saving
   rules.
   ```text
   start: 2025-12-18 10:00
   tz: America/Toronto
   ```

3. **Floating Local Time**
   If no offset or `tz` is provided, the time is considered "floating" and will be shown exactly as written, regardless
   of the device's timezone settings.
   ```text
   start: 2025-12-18 10:00
   ```

---

## ⚙️ Settings

Customize your experience in the Joplin Settings (`Tools` > `Options` > `My Calendar`):

### General

- **Week starts on**: Choose between **Monday** (default) or **Sunday** for the calendar grid.
- **Day events auto-refresh**: Set the interval (in minutes) for how often the day's event list updates. (Default: 1
  min).

### ICS Import

- **ICS import alarm range**: Define how many days into the future (up to 365) the plugin should scan and generate
  native Joplin reminders from your ICS files. (Default: 30 days).
- **ICS export links (Desktop only)**: Add up to 4 quick-access links to your favorite calendar exporters (e.g., Google
  Calendar Export URL). These will appear as convenient buttons in the import panel.

### Developer

- **Enable debug logging**: Activates a visible log box and extra console output to help troubleshoot any issues.

---

## 👨‍💻 Development

This plugin is built with **modern TypeScript** and focused on high code quality.

### Commands:

- `npm run build`: Compile the project.
- `npm run pack`: Create the `.jpl` distribution file.
- `npm test`: Run the extensive test suite (250+ cases).
- `npm run lint`: Check code style and common patterns.

### Security First:

The code implements strict sanitization to ensure that imported calendar data cannot execute arbitrary Markdown or break
the Joplin interface.

---

## 📄 License

Copyright (c) 2024-2026 Volodymyr Oliinyk.
Licensed under the **MIT License**. See the [LICENSE](LICENSE) file for details.
