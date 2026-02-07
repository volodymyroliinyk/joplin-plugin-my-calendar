# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.5.2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.5.1...v1.5.2) (2026-02-07)

### [1.5.1](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.5.0...v1.5.1) (2026-02-07)


### 🐛 Bug Fixes

* resolve race condition in Android WebView initialization ([93030fc](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/93030fc945dadcb0bc8521e922cb0873784d6977))

## [1.5.0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.4.1...v1.5.0) (2026-02-06)


### ✨ Features

* add time format setting (12h/24h) ([6a11512](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a115128e97b1f81babcaea1df531c4327d32ed6))


### 🐛 Bug Fixes

* prevent UI reload on panel focus ([1ee22db](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/1ee22db78c6425102e6607eaab0c69a0a027eaf2))

### [1.4.1](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.4.0...v1.4.1) (2026-02-05)


### 🐛 Bug Fixes

* allow release script to commit to main branch ([4413e58](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/4413e5815e1a89e1a3ce538bcbfcb7fa2ebaee70))
* reduce timezone warning spam and fix weekly recurrence fallback ([ec38d68](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/ec38d685087fd1ef289f58402295309773f9324c))

## [1.4.0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.3.1...v1.4.0) (2026-02-05)


### ✨ Features

* add alarm indicators to UI and fix timezone handling for recurring events ([de7f5ef](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/de7f5ef51cac2899b7b3b0b77eaff5c236888b84))
* implement week numbers with support for Monday/Sunday starts ([c0c0fb8](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/c0c0fb80a7bcf64887ce01701e86f1933de9ecf9))

### [1.3.1](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.3.0...v1.3.1) (2026-02-04)


### 🐛 Bug Fixes

* eliminate UI flickering and improve mobile initialization ([01d378f](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/01d378f198a416777414c2c4d92627f9b903f58c))

## [1.3.0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.7...v1.3.0) (2026-02-04)


### ✨ Features

* ui enhancements ([af04211](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/af04211e1efcb8816ebd3decec7da11a74048118))

### [1.2.7](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.6...v1.2.7) (2026-02-02)


### 🐛 Bug Fixes

* ensure publish folder is included in npm package ([213f287](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/213f28721fbd041804e96351bb6b2dbf8d04e28c))

### [1.2.6](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.5...v1.2.6) (2026-02-02)

### [1.2.5](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.4...v1.2.5) (2026-02-01)

### [1.2.4](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.3...v1.2.4) (2026-02-01)

### [1.2.3](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.2.2...v1.2.3) (2026-02-01)

### 1.2.2 (2026-02-01)


### 🐛 Bug Fixes

* add authentication checks and redundant build step to release script ([4c59a6d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/4c59a6d681b75b825b73b2bc20f185ca30534a5c))
* update pack script and remove deprecated husky config ([6a2ba19](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a2ba19a6b11beb302be0cd0f92717e7e3294dca))
* use static label for toggle command to avoid UI sync issues ([e2d4c99](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/e2d4c99aa880a2d7b837b1cf044bfbaf3678efaa))


### ✨ Features

* add option to empty trash after alarm cleanup ([80ed82b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/80ed82b8102ee73d5b14341d9531849953d40700))
* add setting to toggle event timeline visibility ([263013c](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/263013c05404b96f5d3ab8eaa0ef61aaa322c26d))
* add setting to toggle ICS alarm import ([7cb16f2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7cb16f276f43882136ce432464875ae154605d56))
* enhance alarm notification content ([f12cd29](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f12cd2967900d54ca742d04101cc8545cc2af709))
* improve github release notes extraction ([94d6173](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/94d6173ad08a826cebd71edbfe00ff26b0c140e0))
* optimize alarm synchronization logic ([46a1bc8](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/46a1bc87573e8f9ea51dffe2e1281946e4873c69))

### 1.2.1 (2026-02-01)


### 🐛 Bug Fixes

* add authentication checks and redundant build step to release script ([4c59a6d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/4c59a6d681b75b825b73b2bc20f185ca30534a5c))
* update pack script and remove deprecated husky config ([6a2ba19](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a2ba19a6b11beb302be0cd0f92717e7e3294dca))
* use static label for toggle command to avoid UI sync issues ([e2d4c99](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/e2d4c99aa880a2d7b837b1cf044bfbaf3678efaa))


### ✨ Features

* add option to empty trash after alarm cleanup ([80ed82b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/80ed82b8102ee73d5b14341d9531849953d40700))
* add setting to toggle event timeline visibility ([263013c](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/263013c05404b96f5d3ab8eaa0ef61aaa322c26d))
* add setting to toggle ICS alarm import ([7cb16f2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7cb16f276f43882136ce432464875ae154605d56))
* enhance alarm notification content ([f12cd29](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f12cd2967900d54ca742d04101cc8545cc2af709))
* improve github release notes extraction ([94d6173](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/94d6173ad08a826cebd71edbfe00ff26b0c140e0))
* optimize alarm synchronization logic ([46a1bc8](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/46a1bc87573e8f9ea51dffe2e1281946e4873c69))

## 1.2.0 (2026-02-01)


### 🐛 Bug Fixes

* add authentication checks and redundant build step to release script ([4c59a6d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/4c59a6d681b75b825b73b2bc20f185ca30534a5c))
* update pack script and remove deprecated husky config ([6a2ba19](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a2ba19a6b11beb302be0cd0f92717e7e3294dca))
* use static label for toggle command to avoid UI sync issues ([e2d4c99](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/e2d4c99aa880a2d7b837b1cf044bfbaf3678efaa))


### ✨ Features

* add option to empty trash after alarm cleanup ([80ed82b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/80ed82b8102ee73d5b14341d9531849953d40700))
* add setting to toggle event timeline visibility ([263013c](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/263013c05404b96f5d3ab8eaa0ef61aaa322c26d))
* add setting to toggle ICS alarm import ([7cb16f2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7cb16f276f43882136ce432464875ae154605d56))
* enhance alarm notification content ([f12cd29](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f12cd2967900d54ca742d04101cc8545cc2af709))
* improve github release notes extraction ([94d6173](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/94d6173ad08a826cebd71edbfe00ff26b0c140e0))
* optimize alarm synchronization logic ([46a1bc8](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/46a1bc87573e8f9ea51dffe2e1281946e4873c69))

## 1.1.0 (2026-02-01)


### 🐛 Bug Fixes

* add authentication checks and redundant build step to release script ([4c59a6d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/4c59a6d681b75b825b73b2bc20f185ca30534a5c))
* update pack script and remove deprecated husky config ([6a2ba19](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a2ba19a6b11beb302be0cd0f92717e7e3294dca))
* use static label for toggle command to avoid UI sync issues ([e2d4c99](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/e2d4c99aa880a2d7b837b1cf044bfbaf3678efaa))


### ✨ Features

* add option to empty trash after alarm cleanup ([80ed82b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/80ed82b8102ee73d5b14341d9531849953d40700))
* add setting to toggle event timeline visibility ([263013c](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/263013c05404b96f5d3ab8eaa0ef61aaa322c26d))
* add setting to toggle ICS alarm import ([7cb16f2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7cb16f276f43882136ce432464875ae154605d56))
* enhance alarm notification content ([f12cd29](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f12cd2967900d54ca742d04101cc8545cc2af709))
* improve github release notes extraction ([94d6173](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/94d6173ad08a826cebd71edbfe00ff26b0c140e0))
* optimize alarm synchronization logic ([46a1bc8](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/46a1bc87573e8f9ea51dffe2e1281946e4873c69))

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
