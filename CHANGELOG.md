# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Created `CHANGELOG.md` to track project changes.
- Added a toolbar button for toggling the My Calendar panel.
- Added a keyboard shortcut (`Ctrl+Alt+C`) to toggle the calendar panel.

### Changed

- Improved "Toggle My Calendar" menu item: it now dynamically changes its label ("Show" / "Hide") based on the current
  panel state.

## [1.0.0] - 2025-01-25

### Added

- **Initial release of My Calendar for Joplin.**
- **Calendar View**: Interactive monthly grid and detailed day view.
- **Notes as Events**: Markdown-based event definition block (` ```mycalendar-event `).
- **ICS Import System**: Support for importing standard calendar files with deduplication.
- **Automated Alarms**: Automatic conversion of ICS `VALARM` to native Joplin Todo notes with reminders.
- **Recurrence Support**: Full support for Daily, Weekly, Monthly, and Yearly recurring events.
- **Timezone Support**: Native handling of IANA timezones and UTC offsets.
- **Security**: Built-in sanitization to protect against XSS in events.
- **Customization**: Settings for week start day, alarm scan range, and more.

[Unreleased]: https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.0.0...HEAD

[1.0.0]: https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/releases/tag/v1.0.0
