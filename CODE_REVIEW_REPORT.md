# Code Review Report: `src` Business Logic

Date: 2026-07-11

Scope: `src/main/**`, `src/ui/**`, plugin entrypoint, import/export, recurrence expansion, event creation, cache, scheduled import, alarm sync, and Joplin bridge logic.

Verification: `npm test` passed: 38 suites, 488 tests.

## Executive Summary

The codebase has good defensive parsing, meaningful tests, and clear separation between parser, service, UI bridge, and Joplin API layers. The highest-risk areas are not broad style problems, but business semantics around recurring events, all-day events, ICS exception imports, and stale UI range cache. These issues can cause wrong calendar display, unexpected alarm creation/deletion, or stale UI after import/create flows.

## Priority P0: Fix First

### 1. Range cache is not cleared after import or manual event creation (resolved)

Files:
- `src/main/uiBridge/panelController.ts:194`
- `src/main/uiBridge/panelController.ts:218`
- `src/main/uiBridge/panelController.ts:272`
- `src/main/uiBridge/panelController.ts:278`
- `src/main/uiBridge/panelController.ts:377`

Problem:
`rangeEventsCache` is local to the panel controller and is keyed by `fromUtc:toUtc` plus global cache version. `handleIcsImportMessage` and `handleCalendarEventCreateMessage` call `invalidateAllEventsCache()`, but they do not call `clearRangeEventsCache()`. Since `invalidateAllEventsCache()` increments the global version, this is usually mitigated, but the local cache lifecycle is split and easy to regress. The explicit clear exists only for `clearEventsCache`.

Impact:
After import/create flows, UI may rely on stale range data if version handling changes, if an async request races, or if a cached range was created around a failed rebuild. This is a user-visible consistency risk.

Recommended fix:
Move invalidation behind one controller-local helper such as `invalidateCalendarData()` that calls both `invalidateAllEventsCache()` and `clearRangeEventsCache()`, then use it for import, create, and manual clear.

### 2. Cancelled recurrence exceptions are imported as standalone events instead of only excluding the master occurrence (resolved)

Files:
- `src/main/services/icsImportService.ts:120`
- `src/main/services/icsImportService.ts:136`
- `src/main/services/icsImportService.ts:140`
- `src/main/services/icsImportService.ts:144`
- `src/main/services/icsImportService.ts:148`

Problem:
`prepareImportedEvents()` adds an `EXDATE` to the master whenever an event has `uid + recurrence_id`, then skips only if status is `cancelled`. For non-cancelled exception instances, the event remains in `prepared` and is later written as a separate note. That is correct for modified instances only if the UI expansion model can render both the master exclusion and the override. However, `expandOccurrences()` currently returns `recurrence_id: undefined`, and the main range expansion path does not model exception override semantics as first-class occurrences.

Impact:
Recurring event feeds with modified instances can create duplicate or confusing events: the master occurrence is excluded, but the exception note may not behave consistently with recurrence/alarm logic. Cancelled exceptions are handled better, but modified exceptions are only partially represented.

Recommended fix:
Define and test the intended model:
- Cancelled exception: add `exdate`, do not create/update a standalone event.
- Modified exception: add `exdate` to master and create/update a non-recurring standalone override event with stable `uid + recurrence_id`.
- Preserve `recurrence_id` in occurrence outputs where alarm and export logic need it.

### 3. All-day semantics are inconsistent between parser, note creation, import, recurrence expansion, and export (resolved)

Files:
- `src/main/parsers/eventParser.ts:305`
- `src/main/parsers/eventParser.ts:307`
- `src/main/services/eventNoteService.ts:145`
- `src/main/services/occurrenceService.ts:95`
- `src/main/pluginMain.ts:58`
- `src/main/pluginMain.ts:59`

Problem:
`parseEventsFromBody()` treats `all_day` `end` as exclusive ICS end and subtracts 1 ms. Event creation stores user-provided `end` without normalizing all-day exclusivity. `expandOccurrences()` for imported `IcsEvent` does not apply the same all-day normalization. Export always emits `DTSTART`/`DTEND` as UTC date-times, never `VALUE=DATE`.

Impact:
All-day imported, created, displayed, alarmed, and exported events can shift by one day or become timed UTC events. This is especially risky across time zones.

Recommended fix:
Introduce one canonical all-day representation:
- Internally store all-day start/end as local date boundaries plus `allDay`.
- Parse ICS `VALUE=DATE` as date-only.
- Export all-day events as `DTSTART;VALUE=DATE` and exclusive `DTEND;VALUE=DATE`.
- Add tests for one-day and multi-day all-day events across non-UTC timezone.

## Priority P1: High

### 4. Recurrence expansion can throw on DST-gap occurrences and break the whole range request (resolved)

Files:
- `src/main/services/occurrenceService.ts:165`
- `src/main/services/occurrenceService.ts:207`
- `src/main/services/occurrenceService.ts:238`
- `src/main/services/occurrenceService.ts:277`
- `src/main/utils/dateUtils.ts:178`

Problem:
`zonedTimeToUtcMs()` intentionally throws for non-existent local times during DST spring-forward gaps. Daily and weekly recurrence expansion do not catch this. Monthly/yearly catch some calls but not all stop-condition calls.

Impact:
A recurring event scheduled at a non-existent local time can make a range request fail and return an empty calendar response via the panel controller catch path.

Recommended fix:
Wrap each occurrence conversion in a safe helper. Decide whether to skip non-existent local times or shift them forward according to product rules. Add DST-gap recurrence tests.

### 5. Import scans only the target notebook for existing events, which can duplicate events across notebooks (resolved)

Files:
- `src/main/uiBridge/panelController.ts:183`
- `src/main/uiBridge/panelController.ts:191`
- `src/main/services/scheduledIcsImportService.ts:242`
- `src/main/services/scheduledIcsImportService.ts:252`
- `src/main/services/icsImportService.ts:293`

Problem:
Manual and scheduled imports pass `existingNotesFolderId = targetFolderId`, so matching is limited to that notebook. If the same feed was previously imported into another notebook, the importer creates new notes instead of moving/updating existing ones.

Impact:
Changing target notebook or folder mapping can duplicate entire calendars.

Recommended fix:
Make this an explicit import setting:
- Fast scoped mode: match only target notebook.
- Global dedupe mode: scan all notes, update/move existing matches.
Default should be chosen deliberately and surfaced in UI/settings.

### 6. Alarm cleanup keeps stale future alarms when the source alarm disappears unless the old alarm is completed (resolved)

Files:
- `src/main/services/alarmService.ts:203`
- `src/main/services/alarmService.ts:209`
- `src/main/services/alarmService.ts:283`

Problem:
When a future existing alarm no longer matches any desired alarm, the code deletes it only if it is completed. Incomplete future alarms remain.

Impact:
Users may receive obsolete reminders after an ICS update removes or changes alarms.

Recommended fix:
Delete or update unmatched future alarms owned by this plugin regardless of completion state, possibly with a short grace rule only for recent past alarms.

### 7. Scheduled import does not run once at startup (resolved as compromis)

Files:
- `src/main/services/scheduledIcsImportService.ts:299`
- `src/main/services/scheduledIcsImportService.ts:300`

Problem:
`refresh()` installs `setInterval()`, but does not call `runOnce()` immediately.

Impact:
After enabling scheduled import or starting Joplin, the first sync waits for the full interval. That is inconvenient and can look broken.

Recommended fix:
Run one import shortly after scheduling, or add a setting for "run on startup".

## Priority P2: Medium

### 8. ICS import metadata must remain available after notes are parsed (resolved)

Files:
- `src/main/parsers/eventParser.ts`
- `src/main/services/noteBuilder.ts`

Problem:
ICS import already persists recurrence, all-day, timezone, alarm, UID, and recurrence identity metadata in
`mycalendar-event` blocks. The runtime event parser previously reduced alarms to `hasAlarms` and did not expose the
stored UID or recurrence identity.

Impact:
Imported events remained correct in their notes, but downstream calendar logic could not access the complete imported
identity and alarm metadata after reading those notes.

Resolution:
The event parser now retains `uid`, `recurrence_id`, and every valid structured `valarm`. Invalid alarm JSON is ignored
without making the event unavailable. There is currently no user-facing ICS export feature, so export semantics are
outside this finding.

### 9. Date parsing accepts invalid calendar dates through JavaScript normalization (resolved)

Files:
- `src/main/parsers/eventParser.ts:120`
- `src/main/parsers/eventParser.ts:124`
- `src/main/parsers/eventParser.ts:150`

Problem:
`parseDateTimeToUTC()` trusts `new Date()` in offset/local fallback paths. JavaScript normalizes impossible dates in some cases instead of rejecting them.

Impact:
Malformed note data can silently become a different date.

Resolution:
`parseDateTimeToUTC()` now validates Gregorian year/month/day and time components before constructing a `Date` in
date-only, UTC, explicit-offset, device-local, and IANA timezone paths. Arbitrary `Date` fallback parsing was removed,
local and zoned results are verified against the requested wall-clock components, and non-existent DST-gap times are
rejected. Regression tests cover impossible dates, invalid times and offsets, valid leap days, and DST gaps.

### 10. Recurrence interval can create unbounded heavy expansions for very large visible ranges (resolved)

Files:
- `src/main/services/occurrenceService.ts:165`
- `src/main/services/occurrenceService.ts:201`
- `src/main/services/occurrenceService.ts:233`
- `src/main/services/occurrenceService.ts:274`

Problem:
Expansion loops are bounded by `toUtc`/`until`, but there is no maximum occurrence cap per event or per request.

Impact:
Large export ranges or malformed repeat rules can consume too much CPU/memory.

Resolution:
Recurrence expansion now enforces caps of 2,000 occurrences per event, 10,000 occurrences per request, and 10,000
loop iterations per event. Hitting a cap stops further expansion and writes a contextual warning. Regression tests
cover a single daily series and multiple series over a 75-year request range.

## Priority P3: Low / Maintainability

### 11. Business rules are duplicated across manual notes, ICS import, event creation, and alarm expansion (resolved)

Files:
- `src/main/parsers/eventParser.ts`
- `src/main/services/eventNoteService.ts`
- `src/main/services/icsImportService.ts`
- `src/main/services/occurrenceService.ts`

Problem:
Timezone normalization, repeat validation, all-day handling, exception date normalization, and date parsing are implemented in multiple layers.

Impact:
Future fixes are easy to apply in one path and miss another.

Resolution:
Added `calendarEventNormalizer.ts` as the canonical boundary for timezone, repeat frequency/interval, weekday,
month-day, calendar boolean, all-day range/end, recurrence exception, and ICS event normalization. Manual note parsing,
event creation, ICS preparation and note building, recurrence expansion, and alarm synchronization now use these shared
rules. Focused tests verify canonical values and immutability across the shared normalization surface.

### 12. Duplicate ownership warnings are debug-only and not surfaced to users (resolved)

Files:
- `src/main/services/icsImportService.ts:308`
- `src/main/services/icsImportService.ts:310`
- `src/main/uiBridge/panelController.ts:92`

Problem:
Duplicate event ownership increments `issues`, but the specific note IDs are only logged through debug.

Impact:
Users see `issues=N` without enough information to fix duplicate calendar notes.

Recommended fix:
Return structured warnings from import and show a concise "details" status/log entry in the import UI.

Resolution:
Duplicate ownership conflicts are now returned as structured warnings containing the event key, both conflicting note IDs,
the retained owner, and a concise message. Manual imports surface each warning through an eight-second warning toast and
the import status channel; the import UI also records both the warning and its details. Regression tests cover the service,
panel bridge, and import UI paths.

## Suggested Implementation Order

1. Add regression tests for all-day import/create/export and DST-gap recurrence.
2. Fix all-day canonical model and export semantics.
3. Fix recurrence exception import model and preserve `recurrence_id` where needed.
4. Centralize panel cache invalidation after import/create/clear.
5. Fix alarm cleanup for unmatched future alarms.
6. Add import dedupe scope setting.
7. Add startup scheduled-import behavior.
8. Add expansion caps and stricter date validation.
9. Refactor duplicated normalization into one module after behavior is locked by tests.

## Additional Business-Logic Review (2026-07-13)

This pass focuses on ownership boundaries, partial failures, scheduled-import lifecycle, alarm cleanup, and work that
can grow disproportionately with imported data. The findings below are additional to the original review.

## Priority P1: High

### 13. Calendar identity is global across all ICS sources, so one feed can overwrite another (rejected / not applicable)

Files:
- `src/main/services/icsImportService.ts:174`
- `src/main/services/icsImportService.ts:402`
- `src/main/services/icsImportService.ts:427`
- `src/main/services/scheduledIcsImportService.ts:223`

Problem:
Existing event ownership is indexed only by `UID + RECURRENCE-ID`. The source URL or another stable calendar/source
identifier is not part of the key and is not persisted in the event block. Scheduled pairs are then imported one after
another into their configured notebooks. If two feeds contain the same key, the later feed updates the note selected for
the earlier feed and moves it to the later feed's notebook.

Impact:
Events from different calendars can overwrite each other's content and repeatedly move between notebooks on every
scheduled cycle. The same issue occurs when one feed is intentionally configured for two target notebooks.

Recommended fix:
Persist a stable import source ID and use `source ID + UID + RECURRENCE-ID` as imported-note ownership. Migrate legacy
unscoped blocks conservatively. Until migration exists, detect cross-source collisions and report them instead of
updating or moving a note whose source cannot be proven.

Required tests:
- Two scheduled URLs with the same UID create and retain two independent notes.
- Reordering configured pairs does not change ownership or notebook placement.
- Legacy blocks are adopted by at most one source and ambiguous ownership is reported.

Decision:
This finding does not match the intended product semantics. A calendar event is globally identified by
`UID + RECURRENCE-ID`, regardless of the ICS source. When the same event arrives from another source, the existing
Joplin note must be updated and may be moved to the newly specified notebook; a second event note must not be created.
Adding the source ID to the ownership key would create duplicate notes that would also appear as duplicate events in
the calendar. Consequently, the proposed source-scoped identity and its required tests will not be implemented. When
multiple sources contain the same event identity, the later import deterministically supplies the current content and
notebook placement.

### 14. A settings refresh during an active scheduled import can leave the event cache stale (resolved)

Files:
- `src/main/services/scheduledIcsImportService.ts:223`
- `src/main/services/scheduledIcsImportService.ts:243`
- `src/main/services/scheduledIcsImportService.ts:276`
- `src/main/services/scheduledIcsImportService.ts:287`

Problem:
`refresh()` increments `configVersion` while a cycle may still be running. If the version changes while
`importIcsIntoNotes()` is mutating notes, the next loop iteration returns early. Cache invalidation and `onAfterImport`
run only after the whole loop and only for the still-current version.

Impact:
The import can successfully create, update, or delete notes while the panel continues to serve the old cached event
set. The cycle can also stop after only some configured feeds, without a final summary for the mutations already made.

Recommended fix:
Track whether any mutation-capable import completed and finalize cache invalidation in `finally`, irrespective of config
version. Defer application of refreshed configuration until the active cycle finishes, or only cancel before the first
mutation. Do not use an early `return` after a mutation without running finalization.

Required tests:
- Refresh settings while `importIcsIntoNotes()` is pending, then verify cache invalidation after it resolves.
- Refresh between two configured feeds and verify deterministic completion/cancellation plus a correct summary.
- Dispose during an active import and verify completed mutations still invalidate the cache.

Resolution:
Configuration refresh now clears the previous timer immediately but waits for the active import cycle to finish before
installing a timer for the refreshed settings. Each active cycle keeps its original configuration snapshot and completes
all configured feeds deterministically. Cache invalidation and `onAfterImport` finalization run from `finally` whenever
at least one mutation-capable import completed, regardless of a refresh or disposal during that import. Regression tests
cover refresh during a pending note import, refresh between feeds with an aggregated summary, and disposal during import.

### 15. Disabling ICS alarms does not delete past incomplete alarms as the setting promises (resolved)

Files:
- `src/main/settings/settings.ts:370`
- `src/main/services/alarmService.ts:205`
- `src/main/services/alarmService.ts:214`
- `src/main/services/alarmService.ts:230`
- `tests/services/alarmService.test.ts:99`

Problem:
The setting says existing imported alarms are deleted on re-import when alarm import is disabled. The synchronization
code instead keeps every recent past alarm and keeps old past alarms unless they are completed. This retention runs
before the unmatched-alarm deletion logic, even when `alarmsEnabled` is false. The current test suite explicitly locks
in retention of old incomplete alarms but does not cover disabling alarms with a past incomplete Todo.

Impact:
Turning the feature off does not turn it off completely. Imported alarm Todos can remain indefinitely and continue to
appear as incomplete work after the user expects cleanup.

Recommended fix:
When alarms are disabled, delete all alarm notes owned by the events in the current import before applying normal
age/completion retention. Keep the retention policy only for enabled alarm synchronization, and do not delete alarms
belonging to unrelated event keys or sources.

Required tests:
- Disabled alarms delete future, recent-past, and old incomplete imported alarms.
- Enabled alarms retain past incomplete alarms according to the intended notification policy.
- Alarms for event keys absent from the current source remain untouched.

Resolution:
Disabled alarm synchronization now deletes every existing alarm owned by an event key in the current import before any
age, completion, matching, or notebook-placement rules are applied. The normal past-alarm retention policy remains
unchanged when alarm import is enabled. Alarm notes for event keys absent from the current import remain untouched. A
regression test covers future, recent-past, old incomplete, and unrelated alarms in one deterministic scenario.

### 16. Duplicate event keys inside a new feed can create duplicate notes concurrently (resolved)

Files:
- `src/main/services/icsImportService.ts:105`
- `src/main/services/icsImportService.ts:385`
- `src/main/services/icsImportService.ts:452`
- `src/main/services/icsImportService.ts:457`
- `tests/services/icsImportService.test.ts:1368`

Problem:
Prepared events are not deduplicated by `UID + RECURRENCE-ID`. When no matching note exists yet, every duplicate is
added to `pendingCreates`, and those entries are created concurrently. The in-memory ownership index is not updated
when an item is queued or created. The existing duplicate-key test covers repeated updates to an already existing note,
not duplicate creation from an empty state.

Impact:
One import can create multiple owner notes for the same event key. Which created note is retained in
`importedEventNotes` is completion-order dependent, so alarm linkage is nondeterministic and later imports only warn
about the duplicate ownership.

Recommended fix:
Deduplicate the prepared feed before mutations using a keyed `Map`. Define a deterministic winner, preferably using ICS
revision metadata such as `SEQUENCE` and `LAST-MODIFIED`, with a documented input-order fallback. Reject or report
ambiguous duplicates rather than scheduling multiple creates.

Required tests:
- Duplicate keys with no existing note produce exactly one note and one deterministic alarm owner.
- Duplicate revisions select the documented winner regardless of create concurrency.
- Master and recurrence exceptions remain distinct keys.

Resolution:
Events are now deduplicated by `UID + RECURRENCE-ID` before any Joplin mutations are scheduled. The deterministic winner
is the event with the higher ICS `SEQUENCE`, then the later `LAST-MODIFIED`; when revision metadata is equal or absent,
the later `VEVENT` in input order wins. `SEQUENCE` and `LAST-MODIFIED` are parsed from ICS input for this decision.
Discarded duplicates increment `issues` and are returned as structured `duplicate_feed_event` warnings. Regression tests
verify a single new event note and deterministic alarm owner, revision-based selection before concurrent creation, the
documented input-order fallback, and distinct ownership for a master and its recurrence exception.

### 17. Tag attachment failure reports event creation as failed after the note already exists (resolved)

Files:
- `src/main/services/eventNoteService.ts:192`
- `src/main/services/eventNoteService.ts:197`
- `src/main/services/eventNoteService.ts:203`
- `src/main/uiBridge/panelController.ts:219`

Problem:
The event note is created before tags are attached. Any tag API failure rejects the entire operation even though the
note already exists, and earlier tags may already be attached. The UI therefore receives a creation failure rather than
a successful note with tag warnings.

Impact:
The user can retry the form and create a second event with a new UID. The first event may remain outside the refreshed
cache/UI path, with a partially applied tag set, making the failure appear to have lost data when it actually duplicated
it.

Recommended fix:
Treat note creation as the commit point. Return the created note plus structured tag-attachment warnings, invalidate the
event cache, and show partial-success status. Alternatively, compensate by deleting the newly created note only if that
destructive rollback is proven safe, but partial success is the safer Joplin integration behavior.

Required tests:
- Failure on the first and a later tag still returns the created note and warning details.
- The panel invalidates its cache and reports partial success without encouraging a duplicate retry.
- Successful tags remain attached when another tag fails.

Resolution:
Event note creation is now the commit point. Each selected tag is attached independently; a failed attachment produces
a structured `tag_attachment_failed` warning with the tag ID and error details, while later tags are still attempted.
The panel treats this as partial success: it invalidates the event cache, opens the created note, redraws the calendar,
posts `calendarEventCreateDone` with warnings, and shows a warning toast instead of a creation error. The event form
shows that the note was created and reports the number of tags that could not be attached. Regression tests cover
failure on the first and a later tag, preservation of successful attachments, and the complete panel/UI success path.

### 18. Invalid ICS timezone identifiers are silently erased and can shift event time (resolved)

Files:
- `src/main/services/calendarEventNormalizer.ts:9`
- `src/main/services/calendarEventNormalizer.ts:109`
- `src/main/services/calendarEventNormalizer.ts:120`
- `src/main/services/icsImportService.ts:105`

Problem:
`normalizeTimeZone()` returns `undefined` for an unsupported non-empty TZID, and `normalizeIcsEvent()` replaces the
original value with that result before the note block is built. A local datetime then falls back to device-timezone
interpretation downstream. The original source TZID is no longer available for diagnosis or future timezone mappings.

Impact:
An otherwise valid imported event can silently move to a different instant depending on the user's device timezone.
The persisted note looks like a floating event, so subsequent imports and devices can interpret it differently.

Recommended fix:
Make invalid non-empty timezone input a structured import issue. Skip/quarantine the affected event, or preserve the
original TZID separately while marking it unresolved; never silently convert it into an absent timezone. Add explicit
aliases only through a tested mapping table.

Required tests:
- Unsupported TZID does not become an apparently valid floating event.
- A known alias maps deterministically when alias support is enabled.
- Import results identify the affected UID without exposing unrelated source data.

Resolution:
The import preparation boundary now validates every non-empty timezone before event normalization. An unsupported TZID
causes the affected event to be skipped rather than converted into a floating event, increments `issues`, and returns a
structured `invalid_event_timezone` warning containing only the UID, TZID, and VEVENT input index. Explicit timezone
aliases are defined in a tested mapping table; `Eastern Standard Time` deterministically maps to `America/New_York`.
Regression tests verify that invalid events create no notes, warnings omit unrelated event content, and the supported
alias is persisted as its canonical IANA timezone.

## Priority P2: Medium

### 19. Alarm reconciliation has multiplicative work and no VALARM-per-event limit (resolved)

Files:
- `src/main/services/alarmService.ts:206`
- `src/main/services/alarmService.ts:211`
- `src/main/services/alarmService.ts:235`
- `src/main/services/alarmService.ts:298`

Problem:
Each existing alarm scans the complete desired-alarm array until it finds an unmatched timestamp. Recurrence expansion
is capped, but every occurrence is multiplied by the number of imported VALARMs, and the VALARM count itself is not
bounded here. Matching is therefore `O(existing alarms * desired alarms)` after the desired list has already been
materialized.

Impact:
A large or hostile feed can cause high CPU and memory use during import despite recurrence caps. Normal calendars with
several alarms per occurrence also pay unnecessary quadratic matching cost.

Recommended fix:
Cap accepted VALARMs per event and total desired alarms per import. Index desired alarms by normalized millisecond
timestamp into queues so reconciliation is approximately linear. Report truncation as an import issue rather than
silently dropping work.

Required tests:
- Excess VALARMs are capped and reported.
- Duplicate alarm timestamps reconcile deterministically.
- A maximum-size recurrence stays within the configured desired-alarm and operation limits.

### 20. Alarm cleanup can permanently empty unrelated items from Joplin trash (resolved)

Files:
- `src/main/services/alarmService.ts:348`
- `src/main/services/alarmService.ts:350`
- `src/main/settings/settings.ts`

Problem:
After deleting at least one imported alarm, the optional cleanup executes Joplin's global `emptyTrash` command. The
command is not scoped to plugin-created alarm notes, so this business operation crosses the plugin's ownership boundary.
The setting warns about the behavior, but an ordinary alarm reconciliation is still the trigger for an irreversible
global action.

Impact:
Cleaning up one stale alarm can permanently delete unrelated user notes that happen to be in trash at that moment.

Recommended fix:
Remove automatic global trash emptying from alarm synchronization. If retained, expose it as a separate explicit user
command with confirmation and make clear that it is a global Joplin operation, not part of importing a calendar.

Required tests:
- Normal alarm deletion never invokes `emptyTrash`.
- Any explicit trash command is isolated from import and requires a direct user action.

## Revised Recommended Order

1. Add source-scoped ownership before expanding multi-feed behavior.
2. Guarantee scheduled-import finalization and cache invalidation across refresh/dispose races.
3. Make alarm-disable cleanup match the documented setting.
4. Deduplicate feed keys before any note mutations.
5. Treat event-note creation with tag failures as partial success.
6. Reject or quarantine unresolved timezones without losing the original TZID.
7. Bound and index alarm reconciliation work.
8. Remove global trash emptying from automatic alarm synchronization.

## Additional Business-Logic Review (2026-07-14)

This pass focuses on mutation commit points, consistency after partial Joplin API failures, cache concurrency, and
range-boundary semantics. The findings below are additional to the previous review and are not resolved by the alarm
trash fix.

## Priority P1: High

### 21. A successful alarm-note creation followed by a failed normalization update creates an untracked duplicate (resolved)

Files:
- `src/main/services/alarmService.ts:384`
- `src/main/services/alarmService.ts:395`
- `src/main/services/alarmService.ts:403`
- `src/main/services/alarmService.ts:407`

Problem:
Alarm creation is treated as successful only after a second `updateNote()` call that repeats `todo_due`,
`todo_completed`, and `is_todo`. If `createNote()` succeeds but this defensive update fails, the catch block records an
issue and does not increment `alarmsCreated`, even though the alarm note already exists in Joplin. The returned result
therefore describes the operation as a failure without retaining the created note ID or reporting partial success.

Impact:
On the next import, a delayed index refresh or an incomplete create payload can cause another alarm note to be created
for the same event and timestamp. Users can receive duplicate reminders, while import summaries undercount the notes
that were actually created. A transient failure in the second API call is enough to enter this state.

Recommended fix:
Treat `createNote()` as the commit point. Once it returns an ID, increment the created count and report any follow-up
normalization failure as a structured partial-success warning. Prefer verifying whether the create API already persisted
the Todo fields before issuing a second write. If the second write is required, keep the created ID in the result so the
same run and subsequent reconciliation can own it deterministically.

Required tests:
- `createNote()` succeeds and the follow-up `updateNote()` fails: one created alarm and one warning are reported.
- A retry after that partial failure does not create a second alarm for the same event and timestamp.
- A create response without an ID has explicitly defined result and retry semantics.

Resolution:
Alarm creation now uses `createNote()` as its commit point and increments `alarmsCreated` immediately after that call
succeeds. A failed defensive Todo-field update produces an `alarm_normalization_failed` warning containing the created
note ID instead of reclassifying the creation as failed. A successful response without an ID is explicitly reported as
`alarm_created_without_id`. Regression tests cover partial success, a retry that reuses the indexed alarm rather than
creating a duplicate, and the no-ID response path.

### 22. ICS import mutates its in-memory source of truth before Joplin confirms the write (resolved)

Files:
- `src/main/services/icsImportService.ts:453`
- `src/main/services/icsImportService.ts:458`
- `src/main/services/icsImportService.ts:496`
- `src/main/services/icsImportService.ts:516`
- `src/main/services/icsImportService.ts:522`

Problem:
Both cancelled-exception handling and normal event updates modify `existingMaster.body` / `existing[key]` before
awaiting `updateNote()`. If the write fails, those mutations are not rolled back. Later events that share the same note
then build their patches from state that Joplin never persisted. A later successful patch can accidentally include the
previous failed change, but the counters and warnings still report that earlier event as failed. If no later patch runs,
the in-memory state simply diverges from the database for the remainder of the import.

Impact:
Results depend on event order and whether multiple calendar blocks share one note. The importer can report one failed
and one successful update while persisting both, or base alarm ownership and later comparisons on content that was not
saved. This makes partial failures nondeterministic and makes import summaries unreliable for recovery decisions.

Recommended fix:
Build the candidate note state without mutating the shared index, await the Joplin write, and publish the new body,
title, and parent into every same-note index entry only after success. For several blocks in one note, preferably group
all transformations into one note-level patch so the note has a single commit point and a single result.

Required tests:
- The first of two same-note updates fails and the second succeeds without silently persisting the failed change.
- A failed cancelled-exception update does not affect a later event patch in the same note.
- Counters and warnings match the exact final body stored by Joplin after a partial failure.

Resolution:
The importer now treats each successful Joplin `updateNote()` as the commit point. Candidate body, title, and notebook
changes remain local until the write resolves; only then are they published to every indexed event key belonging to the
same note. Cancelled recurrence exceptions follow the same rule. Regression tests verify that failed normal and
cancelled-exception updates cannot leak into a later successful same-note patch and that result counters match the
persisted mutations.

## Priority P2: Medium

### 23. Incremental note refresh can overwrite a newer full-cache rebuild with a stale read (resolved)

Files:
- `src/main/services/eventsCache.ts:44`
- `src/main/services/eventsCache.ts:57`
- `src/main/services/eventsCache.ts:58`
- `src/main/services/eventsCache.ts:72`

Problem:
`refreshNoteCache()` checks only whether `allEventsCache` is non-null after its asynchronous note read. It does not
capture and compare `cacheVersion`. If the cache is invalidated and fully rebuilt while that read is pending,
`allEventsCache` becomes non-null again and the old incremental request is allowed to replace the freshly rebuilt entry.
The comment says invalidation is detected, but the null check detects only the narrower case where no rebuild finishes
before the request returns.

Impact:
A late note-change callback can reintroduce stale or deleted event data immediately after an import or full refresh.
The panel then serves that state as current because the stale incremental operation also increments `cacheVersion` and
clears the failure flag.

Recommended fix:
Capture `cacheVersion` immediately before starting the note fetch and discard the result unless the version is unchanged.
Alternatively serialize incremental refreshes and full rebuilds through one generation-aware update queue. The catch
path must apply the same generation check so an obsolete failed request cannot delete a newer cache entry.

Required tests:
- Pause an incremental fetch, invalidate and rebuild, then resolve the old fetch and verify the rebuilt data wins.
- An obsolete incremental 404/error does not remove a note loaded by a newer rebuild.
- Multiple rapid note-change callbacks converge to the newest Joplin response.

Resolution:
Incremental refresh now captures the global cache generation and receives a monotonically increasing per-request token.
Its success and error paths mutate the cache only while both identifiers remain current. Cache invalidation cancels all
outstanding tokens, and starting a newer refresh for the same note supersedes the older request. Regression tests cover
a stale successful response after rebuild, a stale error after rebuild, and two concurrent refreshes resolving in an
order that previously allowed older data to win.

### 24. Inclusive range boundaries can return the same event in adjacent ranges and days (resolved)

Files:
- `src/main/services/occurrenceService.ts:181`
- `src/main/services/occurrenceService.ts:184`
- `src/main/services/occurrenceService.ts:194`
- `src/main/uiBridge/panelController.ts:365`
- `src/main/uiBridge/panelController.ts:369`

Problem:
Range overlap uses closed intervals: an event is included when `start === toUtc` and also when `end === fromUtc`.
`dateClick` repeats the same `>=` / `<=` rule. Adjacent calendar ranges normally share an endpoint, so a zero-duration
event at midnight, an event beginning exactly at the next range boundary, or an event ending exactly at the current
boundary can belong to both ranges. Timed events generally use an exclusive end instant, making `end === fromUtc` a
non-overlap rather than an overlap.

Impact:
Events can appear on two days, be exported twice when adjacent ranges are combined, or show inconsistently between the
month view and day dialog. Boundary behavior is especially visible for midnight events and all-day end boundaries.

Recommended fix:
Define all query windows as half-open `[fromUtc, toUtc)` and centralize one overlap predicate. For duration events use
`eventStart < toUtc && eventEnd > fromUtc`; define zero-duration events explicitly so an instant belongs to exactly one
window. Apply the same helper in recurrence expansion, non-recurring expansion, day filtering, and export selection.

Required tests:
- An event starting at midnight appears only in the new day, not the previous day.
- An event ending at midnight appears only on the day(s) it actually occupies.
- A zero-duration event at a shared endpoint belongs to exactly one adjacent range.
- Recurring, non-recurring, all-day, day-dialog, and ICS-export paths use identical boundary semantics.

Resolution:
Calendar query windows now consistently use half-open `[fromUtc, toUtc)` semantics. A shared overlap helper handles
duration and zero-duration events and is used by recurring/non-recurring expansion and day-dialog filtering. The
webview now requests exclusive next-midnight boundaries, slices events with the same overlap rules, and computes the
42-day grid end as local midnight using calendar arithmetic so DST does not distort the range. Regression tests cover
adjacent timed and instant events, recurring occurrences at `toUtc`, backend day filtering, webview midnight slicing,
exclusive day requests, and the grid boundary.
