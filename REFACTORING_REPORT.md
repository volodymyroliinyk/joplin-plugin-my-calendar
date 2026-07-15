# Code Quality and Architecture Refactoring Report

Date: 2026-07-14

Scope: plugin backend, Joplin integration boundaries, UI bridge, parsers, services, and plain-JavaScript webview code.

Constraints:
- Preserve existing business behavior.
- Do not modify existing tests to accommodate implementation changes.
- Prefer small, verifiable refactors over framework or dependency changes.
- Keep Joplin API calls behind service or bridge boundaries.

## Review Summary

The project has strong behavioral coverage and generally good separation between parsing, normalization, persistence,
and webview code. The main maintainability costs are concentrated in a few large orchestration modules, duplicated
infrastructure helpers, weak typing at Joplin response boundaries, and bootstrap code that also owns domain formatting.

## Refactoring Worklist

### P1 — Implement in this pass

1. Extract the duplicated bounded-concurrency loop into a reusable typed utility.
2. Move ICS serialization out of `pluginMain` into a focused service.
3. Replace `any`-based event-cache rows and responses with explicit boundary types.
4. Centralize publication of successful note-level import state.
5. Reduce repeated settings access casts by introducing a narrow settings-capability type. Deferred because the
   current test doubles intentionally model partial Joplin capabilities; changing this boundary would create broad
   fixture churn without improving runtime behavior.

### P2 — Apply only where behavior remains mechanically identical

6. Clarify naming of mutation candidates, committed state, and Joplin response objects.
7. Extract small pure helpers from long orchestration functions.
8. Remove stale comments and comments that narrate syntax rather than invariants.

### Deferred

- Splitting the plain-JavaScript calendar webview into modules requires changes to the asset loading/build strategy and
  is not suitable for a behavior-preserving pass.
- Replacing the local Joplin interface with the full upstream API types would create broad test-fixture churn.
- Changing import transaction semantics, retry policy, or user-visible messages is business-logic work, not refactoring.

## Verification Log

Completed refactors:

- Extracted the duplicated bounded-concurrency implementation into `src/main/utils/asyncUtils.ts` and reused it in
  alarm synchronization and ICS import.
- Moved ICS export formatting and serialization from plugin bootstrap into `src/main/services/icsExportService.ts`.
- Replaced `any` at the event-cache note/page boundary with explicit, intentionally permissive Joplin response types.
- Centralized publication of committed ICS-import note state; candidates are still published only after Joplin
  confirms the write.
- Reduced `pluginMain.ts` by 85 lines of domain formatting logic.

Validation performed without modifying tests:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 39 suites and 550 tests passed.
- `npm run build`: webpack compilation passed.
- `git diff --check`: passed.

## Second `src` Review Pass

The second pass re-read every source module with additional focus on public types, partial Joplin capabilities,
webview contracts, naming, and remaining casts. The largest actionable issue was the settings boundary: its public
getters accepted `any`, which propagated thirteen casts into the UI bridge and prevented TypeScript from checking the
shape required by each operation.

Completed in the second pass:

- Introduced narrow `SettingsReader` and `SettingsRegistrar` capability types. They deliberately support partial and
  older Joplin APIs while describing the actual methods used by the module.
- Replaced `any` in all exported settings getters with the read-only capability type.
- Typed settings change events and captured the guarded optional setter before asynchronous callbacks, preserving the
  existing feature-detection behavior.
- Replaced thirteen individual `as any` expressions in `uiSettings.ts` with one documented boundary assertion needed
  for tests that mock all setting getters.
- Narrowed `UiSettingsMessage.weekStart` and `dayEventsRefreshMinutes` from `unknown` to their real domain types.
- Removed an unnecessary panel-id cast in `pluginMain.ts`.

Reviewed but intentionally deferred:

- `calendar.js` and `eventCreate.js` are large, but splitting them requires changing Joplin webview asset loading or
  introducing a UI bundling stage. That is not a safe mechanical refactor.
- Ambient `joplin: any` declarations are compatibility shims at the plugin bootstrap boundary. Replacing them should
  be coordinated with adoption of upstream Joplin API declarations.
- The broad local `Joplin` interface mirrors a dynamic external API and is used by many minimal test doubles. A full
  replacement should be a dedicated typing migration rather than mixed into behavior-preserving cleanup.

Second-pass validation:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 39 suites and 550 tests passed.
- `npm run build`: webpack compilation passed.
- No test files were modified.

## Third `src` Review Pass

The third pass focused on dependency direction, Interface Segregation, typed persistence boundaries, hidden mutation,
and public function contracts. No new business-logic defect was found. The strongest behavior-preserving opportunity
was to stop low-level persistence helpers from depending on the complete plugin API facade.

Completed in the third pass:

- Added a narrow `JoplinNoteDataClient` capability for note and tag persistence. The service now declares only the
  four data methods it consumes instead of depending on settings, views, commands, workspace, and version APIs.
- Changed raw data responses at this boundary to `unknown` and kept the required assertions local to pagination and
  note creation.
- Added a focused folder data capability and explicit `FolderPage` response type, removing optional chaining and a
  broad item-array assertion from normal pagination flow.
- Added explicit return contracts to the safe status reporter and UI-log handler.
- Corrected the stray unterminated `return` in the toast utility; runtime behavior is unchanged.

Reviewed but intentionally deferred:

- Sharing pagination machinery between folder and note services could reduce a small amount of duplication, but the
  endpoints currently have different safety policies (`maxPages` exists only for notes). Merging them would subtly
  change failure behavior.
- Consolidating repeated DOM/color/logger helpers across plain-JavaScript webviews still requires an asset-loading or
  bundling decision.
- Migrating the complete plugin facade from `any` to generic `unknown` API methods remains a dedicated, cross-cutting
  typing migration because it affects nearly every Joplin test double.

Third-pass validation:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 39 suites and 550 tests passed.
- `npm run build`: webpack compilation passed.
- No test files were modified.

## Fourth `src` Review Pass

The fourth pass concentrated on local duplication and function complexity after the architectural boundaries had been
narrowed. No additional safe module extraction was identified. The remaining actionable duplication was isolated in
settings sanitization and the settings change callback.

Completed in the fourth pass:

- Extracted one control-character replacement helper shared by notebook-title and alarm-emoji sanitizers. Their trim,
  whitespace compaction, default, and length-limit semantics remain unchanged.
- Replaced six nearly identical asynchronous setting-repair closures with one typed `normalizeStoredSetting` helper.
- Kept the original key-check order and sequential writes, so change-event ordering and Joplin persistence behavior
  are preserved.
- Retained the alarm emoji fallback as an explicit domain normalizer rather than hiding it in the generic helper.

Reviewed but intentionally deferred:

- Scheduled-import and export-link parsers share delimiter mechanics but enforce different field policies. A generic
  parser would save little code while making the domain rules less obvious.
- Remaining duplication in webview DOM, theme-color, and logger helpers cannot be removed cleanly without deciding how
  shared scripts are loaded and versioned by Joplin.
- Further splitting of orchestration functions now risks changing sequencing, retry behavior, or observable errors and
  falls outside this behavior-preserving pass.

Fourth-pass validation:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 39 suites and 550 tests passed.
- `npm run build`: webpack compilation passed.
- No test files were modified.

## Fifth `src` Review Pass

The fifth pass focused on plugin bootstrap safety, ambient API boundaries, error naming, and the remaining broad input
types in the shared Joplin facade. The bootstrap still used an untyped `j` variable and misleading comments, while
several facade methods accepted `any` even though callers do not need unchecked input types.

Completed in the fifth pass:

- Added local `RunnerJoplinApi`, `PluginRegistration`, and `PluginRunner` contracts to the entrypoint.
- Removed all `any` casts from `src/index.ts`, renamed `j` to `joplinApi`, and documented why plugin modules are loaded
  only after detecting the runner API.
- Corrected stale and malformed bootstrap comments without changing lazy-loading or error-isolation behavior.
- Renamed caught bootstrap values from `e` to `error` for clarity.
- Replaced broad `any` input parameters in the shared Joplin facade with `unknown`, `unknown[]`, or
  `Record<string, unknown>` for settings, data writes, panel messages, toast payloads, menu options, and commands.
- Preserved dynamic Joplin response types where converting them to `unknown` would require a dedicated repository-wide
  response-validation migration.

Reviewed but intentionally deferred:

- Ambient global and `api` module declarations remain `any` compatibility shims because existing code accesses the
  full external object. They should be replaced together with upstream Joplin typings.
- `data.get/post/put` and `commands.execute` still return dynamic values. Tightening these outputs requires explicit
  response types or validators at every consumer and is larger than a behavior-preserving cleanup.
- Silent catches were retained where failure is explicitly non-fatal: optional status notifications, compatibility
  probes, invalid user input, and best-effort Joplin UI operations.

Fifth-pass validation:

- `npx tsc --noEmit`: passed.
- `npm run lint`: passed.
- `npm test`: 39 suites and 550 tests passed.
- `npm run build`: webpack compilation passed.
- No test files were modified.
