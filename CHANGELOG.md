# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.7.0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.6.3...v1.7.0) (2026-04-12)


### ✨ Features

* add automated ICS import from URLs ([598156b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/598156bf4ce7e3fb104892df1a73531b7cb739d8))
* add configurable timeline color and reminder emoji settings ([c9309e1](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/c9309e1d0dc55f350acae7c60bc09a5c7ba3ce64))
* make ICS reminder emoji configurable ([75a79eb](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/75a79eb19d5d5cf681587395476fbb7867f6a102))
* SETTING_IMPORT_DEFAULT_EVENT_COLOR for auto import and manual import ([6a1aa38](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6a1aa38ecf2681d5a16e5bcaf366c0f938fd08b7))


### ⚡ Performance Improvements

* speed up ICS import by scoping note scans and parallelizing writes ([9789159](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/9789159fb2d5feb7ddd1469c0e3cb8e98a048fe0))


### 🐛 Bug Fixes

* **cache:** guard incremental note refresh against cache invalidation race ([7c1cb68](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7c1cb68e84ff16f8a900930ee93f04ce0a0210d9))
* **colors:** normalize all hex colors to lowercase across import and settings paths ([1140969](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/1140969df27cf07c2e1e43b7377d7e6438bf4915))
* handle date-only repeat_until values and disable ICS alarms fallback ([0bbf21e](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/0bbf21e636d95824a9c056bb17b8dc349ea28252))
* handle EXDATE and cancelled recurring ICS exceptions ([66a7f72](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/66a7f722f45fb4b247bffd810666493063a9c437))
* keep overlapping multi-day events in date click list ([6481302](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/648130280ea8920b479a09d40fe256d9a6c8ec4d))
* make ICS event ownership deterministic during import ([0ffe209](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/0ffe2098002c693fcb279a213876df643c8ce22c))
* normalize all imported and configured hex colors to lowercase ([dfa5e71](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/dfa5e71985a3663947fbf336cdfd7b468d8a8248))
* normalize imported colors and dedupe recurring weekdays ([219a976](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/219a976b327a9b1cb65fd1f766442612bca3253b))
* **parser:** preserve hex values in color field while keeping inline comment behavior for other fields ([2408a5d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/2408a5d834a581577efe28a3d7329278c517635c))
* preserve local day range and timezone-aware occurrence expansion ([7e17f57](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7e17f57825f946885fe7f91d35254d8dd55f23ca))
* remove legacy 4-pair cap for ICS settings ([f6ae1ec](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f6ae1ec8a4b48f1f42b013caa06214ec771172fc))
* scope default import color override to scheduled ICS import ([7eac35b](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/7eac35ba9af3262a84163b40143c6ef2b387e743))
* scope default import color override to scheduled ICS import ([3ba1a22](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/3ba1a22254811f0040b9e8e8d9130f27c5afe571))
* **toast:** prevent deleted ghost messages from endlessly reappearing after navigation ([70a9b54](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/70a9b549c97d679db2dd397f76b72c971fdfb6ec))
* update .test-status in pre-pack workflow ([5ae2e8d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/5ae2e8d95cb933132510ab3faba14704114f4cc2))

### [1.6.3](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.6.2...v1.6.3) (2026-03-21)

### [1.6.2](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.6.1...v1.6.2) (2026-03-17)


### 🐛 Bug Fixes

* **ui:** handle DST day boundaries when slicing calendar events ([6d3bc3a](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/6d3bc3a1de3db4bb245a6fb33fd6fe68939d01bd))

### [1.6.1](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.6.0...v1.6.1) (2026-03-06)


### 🐛 Bug Fixes

* harden Toggle My Calendar registration for menu toolbar and hotkey ([79e4221](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/79e42211ce70356174444d63d175c47c986c619f))

## [1.6.0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.5.3...v1.6.0) (2026-02-19)


### ✨ Features

* add clear events cache toolbar button ([f16efab](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f16efabbd5a45efb00c68879f5be34d61962f95c))
* **day-events:** add grouped mode with ongoing/feature/past and hide empty sections ([b07c2f4](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/b07c2f4cf5c714ff230bfcbb657897de74efc9b1))


### 🐛 Bug Fixes

* handle missing panel focus on mobile and improve UI error logging ([a6e847d](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/a6e847dcb19030886d8f859604bf6ed38290d746))
* validate date ranges and improve env compatibility ([89989e0](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/89989e04dd9498ccdd6522e9ec8d9daa8f4bc754))

### [1.5.3](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/compare/v1.5.2...v1.5.3) (2026-02-10)


### 🐛 Bug Fixes

* add per-note cache refresh for events ([8e0663f](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/8e0663f6fb8a716a0c14ebd2d30d80c3e026e044))
* fold ics lines to 75 chars ([efcae52](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/efcae52757a12a572adb8653c14a436960a3d3d5))
* persist todo flags during ics import ([80905e9](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/80905e950f4bde791221b5cd4a14ad45f3fe0aa1))
* preserve escaped hash in ics values ([ee5bdc6](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/ee5bdc67a93f8ade039d78df8dfcf64d8ae98010))
* restore ui log routing and unwrap panel messages ([5f71841](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/5f7184101d520bccdb3669a58b7ec5273f3d91ee))
* retain recent alarms and sync todo fields ([f7f55bf](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/f7f55bfbd59ba524e6f39497c07876dc7ecd8efa))
* support multiline descriptions and ignore empty fields ([21340ac](https://github.com/volodymyroliinyk/joplin-plugin-my-calendar/commit/21340acfb71b3a1e52d7964766ae47a4fe16bfbc))

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
