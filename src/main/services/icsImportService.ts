// src/main/services/icsImportService.ts

import {parseImportText} from '../parsers/icsParser';
import {IcsEvent} from '../types/icsTypes';
import {
    extractEventColorFromBody,
    makeEventKey,
    parseUidAndRecurrence,
    extractAllEventKeysFromBody,
    extractAllAlarmKeysFromBody,
    replaceEventBlockByKey
} from '../utils/joplinUtils';
import {syncAlarmsForEvents, ExistingAlarm, AlarmSyncWarning} from './alarmService';
import {buildMyCalBlock} from './noteBuilder';
import {Joplin} from '../types/joplin.interface';
import {createNote, getAllNotesPaged, NoteItem, updateNote} from './joplinNoteService';
import {getIcsImportAlarmsEnabled} from '../settings/settings';
import {getErrorText} from '../utils/errorUtils';
import {createSafeTextReporter} from '../utils/statusNotifier';
import {dbg, err, warn} from '../utils/logger';
import {normalizeIcsEvent, normalizeRecurrenceExceptionDate, normalizeTimeZone} from './calendarEventNormalizer';
import {runWithConcurrency} from '../utils/asyncUtils';

type ExistingEventNote = { id: string; title: string; body: string; parent_id?: string };
type ExistingEventNoteMap = Record<string, ExistingEventNote>;
type ImportedEventNote = { id: string; parent_id?: string; title: string };
type ImportedEventNotes = Record<string, ImportedEventNote>;
type ExistingAlarmsMap = Record<string, ExistingAlarm[]>;
type NoteIdToKeysMap = Record<string, string[]>;
export type DuplicateOwnershipWarning = {
    code: 'duplicate_event_ownership';
    key: string;
    existingNoteId: string;
    duplicateNoteId: string;
    message: string;
};
export type DuplicateFeedEventWarning = {
    code: 'duplicate_feed_event';
    key: string;
    keptInputIndex: number;
    discardedInputIndex: number;
    message: string;
};
export type InvalidTimezoneWarning = {
    code: 'invalid_event_timezone';
    uid: string;
    tzid: string;
    inputIndex: number;
    message: string;
};
type PreparedImportWarning = DuplicateFeedEventWarning | InvalidTimezoneWarning;
type ImportWarning = DuplicateOwnershipWarning | PreparedImportWarning | AlarmSyncWarning;
type ExistingNoteRow = {
    id: string;
    title?: string;
    body?: string;
    parent_id?: string;
    todo_due?: number;
    todo_completed?: number;
    is_todo?: number;
};

type ImportIcsResult = {
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
    issues: number;
    warnings?: ImportWarning[];
};

type ImportColorPolicy = {
    preserveLocalColor: boolean;
    fallbackColor?: string;
};

type ImportIcsOptions = {
    targetFolderId?: string;
    preserveLocalColor: boolean;
    fallbackColor?: string;
    importAlarmRangeDays?: number;
    /**
     * Deprecated: event identity is global, so imports always scan all notes to
     * avoid duplicating an existing UID/RECURRENCE-ID in another notebook.
     */
    existingNotesFolderId?: string;
};

type PendingCreate = {
    key: string;
    desiredTitle: string;
    block: string;
};
type CancelledRecurrenceException = {
    uid: string;
    recurrence_id: string;
    exdate: string;
};
type PreparedImportEvents = {
    events: IcsEvent[];
    cancelledExceptions: CancelledRecurrenceException[];
    masterUidsInImport: Set<string>;
    warnings: PreparedImportWarning[];
};

const CREATE_NOTES_CONCURRENCY = 6;

function pushUniqueExdate(target: IcsEvent | undefined, exdate: string | undefined): void {
    if (!target || !exdate) return;
    const normalized = exdate.trim();
    if (!normalized) return;

    if (!target.exdates) {
        target.exdates = [normalized];
        return;
    }

    if (!target.exdates.includes(normalized)) {
        target.exdates.push(normalized);
    }
}

function compareFeedRevisions(candidate: IcsEvent, current: IcsEvent): number {
    const sequenceDiff = (candidate.sequence ?? 0) - (current.sequence ?? 0);
    if (sequenceDiff !== 0) return sequenceDiff;
    return String(candidate.last_modified || '').localeCompare(String(current.last_modified || ''));
}

function prepareImportedEvents(eventsRaw: IcsEvent[]): PreparedImportEvents {
    const warnings: PreparedImportWarning[] = [];
    const normalized: Array<{ event: IcsEvent; inputIndex: number }> = [];
    eventsRaw.forEach((input, inputIndex) => {
        const rawTimezone = String(input.tz || '').trim();
        const timezone = normalizeTimeZone(rawTimezone);
        if (rawTimezone && !timezone) {
            const uid = String(input.uid || '').trim() || '(missing UID)';
            warnings.push({
                code: 'invalid_event_timezone',
                uid,
                tzid: rawTimezone,
                inputIndex,
                message: `Skipped event ${uid}: unsupported timezone identifier ${rawTimezone}`,
            });
            return;
        }
        normalized.push({event: normalizeIcsEvent({...input, tz: timezone}), inputIndex});
    });
    const winnersByKey = new Map<string, { event: IcsEvent; inputIndex: number }>();
    const unkeyed: IcsEvent[] = [];

    normalized.forEach(({event, inputIndex}) => {
        const uid = String(event.uid || '').trim();
        if (!uid) {
            unkeyed.push(event);
            return;
        }
        const key = makeEventKey(uid, event.recurrence_id);
        const current = winnersByKey.get(key);
        if (!current) {
            winnersByKey.set(key, {event, inputIndex});
            return;
        }

        // Higher SEQUENCE wins, then later LAST-MODIFIED. If revision metadata is
        // equal or absent, the later VEVENT in the input wins deterministically.
        const candidateWins = compareFeedRevisions(event, current.event) >= 0;
        const winner = candidateWins ? {event, inputIndex} : current;
        const discardedInputIndex = candidateWins ? current.inputIndex : inputIndex;
        winnersByKey.set(key, winner);
        warnings.push({
            code: 'duplicate_feed_event',
            key,
            keptInputIndex: winner.inputIndex,
            discardedInputIndex,
            message: `Duplicate event ${key} in ICS input; kept VEVENT ${winner.inputIndex + 1} and ignored VEVENT ${discardedInputIndex + 1}`,
        });
    });

    const events = [...winnersByKey.values()].map(({event}) => event).concat(unkeyed);

    const mastersByUid = new Map<string, IcsEvent>();
    const masterUidsInImport = new Set<string>();
    for (const ev of events) {
        const uid = String(ev.uid || '').trim();
        if (!uid || ev.recurrence_id) continue;
        if (!mastersByUid.has(uid)) {
            mastersByUid.set(uid, ev);
            masterUidsInImport.add(uid);
        }
    }

    const prepared: IcsEvent[] = [];
    const cancelledExceptions: CancelledRecurrenceException[] = [];
    for (const ev of events) {
        const uid = String(ev.uid || '').trim();
        const rid = String(ev.recurrence_id || '').trim();
        const status = String(ev.status || '').trim().toLowerCase();
        if (uid && rid) {
            const exdate = normalizeRecurrenceExceptionDate(rid);
            pushUniqueExdate(mastersByUid.get(uid), exdate);
            if (status === 'cancelled' && exdate) {
                cancelledExceptions.push({uid, recurrence_id: rid, exdate});
            }
        }

        if (status === 'cancelled') {
            continue;
        }

        prepared.push(ev);
    }

    return {events: prepared, cancelledExceptions, masterUidsInImport, warnings};
}

function addExdateToEventBlockByKey(
    body: string,
    uid: string,
    recurrenceId: string | undefined,
    exdate: string,
): string {
    const targetKey = makeEventKey(uid, recurrenceId);
    const normalizedExdate = exdate.trim();
    if (!targetKey || !normalizedExdate) return body;

    const re =
        /(^|\r?\n)([ \t]*```mycalendar-event[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*```)(?=\r?\n|$)/g;

    return body.replace(re, (fullMatch, prefixNL, wholeBlock) => {
        const innerM = wholeBlock.match(/^[ \t]*```mycalendar-event[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*```$/);
        const inner = innerM?.[1] ?? '';
        const meta = parseUidAndRecurrence(inner);

        if (makeEventKey(meta.uid || '', meta.recurrence_id) !== targetKey) return fullMatch;

        const existingExdates = inner
            .split(/\r?\n/)
            .map((line: string) => line.match(/^\s*exdate\s*:\s*(.+?)\s*$/i)?.[1]?.trim())
            .filter(Boolean);
        if (existingExdates.includes(normalizedExdate)) return fullMatch;

        const updatedBlock = wholeBlock.replace(/\r?\n[ \t]*```$/, `\nexdate: ${normalizedExdate}\n\`\`\``);
        return `${prefixNL}${updatedBlock}`;
    });
}

function indexExistingNotes(allNotes: ExistingNoteRow[]): {
    existingByKey: ExistingEventNoteMap;
    existingAlarms: ExistingAlarmsMap;
    noteIdToKeys: NoteIdToKeysMap;
    duplicateOwnershipWarnings: DuplicateOwnershipWarning[];
} {
    const existingByKey: ExistingEventNoteMap = {};
    const existingAlarms: ExistingAlarmsMap = {};
    const noteIdToKeys: NoteIdToKeysMap = {};
    const duplicateOwnershipWarnings: DuplicateOwnershipWarning[] = [];

    for (const n of allNotes) {
        if (typeof n.body !== 'string' || !n.body) continue;

        if (n.body.includes('```mycalendar-event')) {
            const keys = extractAllEventKeysFromBody(n.body);
            if (keys.length) {
                noteIdToKeys[n.id] = (noteIdToKeys[n.id] ?? []).concat(keys);
            }
            for (const k of keys) {
                const existingOwner = existingByKey[k];
                if (existingOwner) {
                    duplicateOwnershipWarnings.push({
                        code: 'duplicate_event_ownership',
                        key: k,
                        existingNoteId: existingOwner.id,
                        duplicateNoteId: n.id,
                        message: `Duplicate event ownership for ${k}: notes ${existingOwner.id} and ${n.id}; keeping ${existingOwner.id}`,
                    });
                    continue;
                }
                existingByKey[k] = {id: n.id, title: n.title || '', body: n.body, parent_id: n.parent_id};
            }
        }

        if (n.body.includes('```mycalendar-alarm')) {
            const metas = extractAllAlarmKeysFromBody(n.body);
            for (const meta of metas) {
                (existingAlarms[meta.key] ??= []).push({
                    id: n.id,
                    todo_due: n.todo_due || 0,
                    body: n.body,
                    todo_completed: n.todo_completed || 0,
                    is_todo: n.is_todo || 0,
                    title: n.title || ''
                });
            }
        }
    }

    return {existingByKey, existingAlarms, noteIdToKeys, duplicateOwnershipWarnings};
}

function publishCommittedNoteState(
    existing: ExistingEventNoteMap,
    noteIdToKeys: NoteIdToKeysMap,
    noteId: string,
    state: Partial<Pick<ExistingEventNote, 'body' | 'title' | 'parent_id'>>,
): void {
    for (const key of noteIdToKeys[noteId] ?? []) {
        const indexed = existing[key];
        if (indexed) Object.assign(indexed, state);
    }
}

function compareExistingNotesForOwnership(a: ExistingNoteRow, b: ExistingNoteRow): number {
    const byId = String(a.id || '').localeCompare(String(b.id || ''));
    if (byId !== 0) return byId;
    return String(a.parent_id || '').localeCompare(String(b.parent_id || ''));
}

function buildImportOptions(
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    fallbackColor?: string,
    importAlarmRangeDays?: number,
    existingNotesFolderId?: string,
): ImportIcsOptions {
    return {
        targetFolderId,
        preserveLocalColor,
        fallbackColor,
        importAlarmRangeDays,
        existingNotesFolderId,
    };
}

function applyImportColors(
    ev: IcsEvent,
    existing: ExistingEventNoteMap,
    policy: ImportColorPolicy,
) {
    const uid = (ev.uid || '').trim();
    const rid = (ev.recurrence_id || '').trim();
    const key = makeEventKey(uid, rid);

    if (policy.preserveLocalColor && existing[key] && !ev.color) {
        const existingColor = extractEventColorFromBody(existing[key].body, uid, rid);
        if (existingColor) ev.color = existingColor;
    }
    if (!ev.color && policy.fallbackColor) {
        ev.color = policy.fallbackColor;
    }
    return key;
}

export async function importIcsIntoNotes(
    joplin: Joplin,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    fallbackColor?: string,
    importAlarmRangeDays?: number,
    existingNotesFolderId?: string,
): Promise<ImportIcsResult> {
    const say = createSafeTextReporter(onStatus);
    const options = buildImportOptions(
        targetFolderId,
        preserveLocalColor,
        fallbackColor,
        importAlarmRangeDays,
        existingNotesFolderId,
    );
    const colorPolicy: ImportColorPolicy = {
        preserveLocalColor: options.preserveLocalColor,
        fallbackColor: options.fallbackColor,
    };

    const eventsRaw = parseImportText(ics);
    const {
        events,
        cancelledExceptions,
        masterUidsInImport,
        warnings: preparationWarnings
    } = prepareImportedEvents(eventsRaw);
    await say(`Parsed ${events.length} VEVENT(s)`);

    const noteFields = ['id', 'title', 'body', 'parent_id', 'todo_due', 'todo_completed', 'is_todo'];
    const allNotes = await getAllNotesPaged(joplin, noteFields);
    allNotes.sort(compareExistingNotesForOwnership);

    const {
        existingByKey: existing,
        existingAlarms,
        noteIdToKeys,
        duplicateOwnershipWarnings,
    } = indexExistingNotes(allNotes);

    let issues = preparationWarnings.length;

    for (const warning of duplicateOwnershipWarnings) {
        issues++;
        dbg(
            'icsImportService',
            `[icsImportService] WARNING: Duplicate event ownership detected for ${warning.key} in notes ${warning.existingNoteId} and ${warning.duplicateNoteId}; keeping lexicographically smallest note id ${warning.existingNoteId}`,
        );
    }

    let alarmsEnabled = false;
    try {
        alarmsEnabled = await getIcsImportAlarmsEnabled(joplin);
    } catch (e) {
        issues++;
        warn('icsImportService', `Failed to read alarms setting; defaulting to disabled. ${getErrorText(e)}`);
    }

    let added = 0, updated = 0, skipped = 0, errors = 0;
    const importedEventNotes: ImportedEventNotes = {};
    const pendingCreates: PendingCreate[] = [];

    for (const cancellation of cancelledExceptions) {
        if (masterUidsInImport.has(cancellation.uid)) {
            continue;
        }

        const masterKey = makeEventKey(cancellation.uid, undefined);
        const existingMaster = existing[masterKey];
        if (!existingMaster) {
            skipped++;
            continue;
        }

        try {
            const newBody = addExdateToEventBlockByKey(
                existingMaster.body,
                cancellation.uid,
                undefined,
                cancellation.exdate,
            );

            if (newBody === existingMaster.body) {
                skipped++;
                continue;
            }

            await updateNote(joplin, existingMaster.id, {body: newBody});
            publishCommittedNoteState(existing, noteIdToKeys, existingMaster.id, {body: newBody});
            updated++;
        } catch (e) {
            errors++;
            issues++;
            err('icsImportService', `ERROR applying cancelled recurrence exception: ${cancellation.uid}|${cancellation.recurrence_id} - ${getErrorText(e)}`);
        }
    }

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) {
            skipped++;
            continue;
        }

        const rid = (ev.recurrence_id || '').trim();
        const key = applyImportColors(ev, existing, colorPolicy);

        if (!alarmsEnabled) {
            ev.valarms = [];
        }

        const block = buildMyCalBlock(ev);
        const desiredTitle = ev.title || 'Event';

        if (existing[key]) {
            try {
                const {id, title, parent_id} = existing[key];
                // CRITICAL: Always use the LATEST body from our local "existing" cache
                // because multiple sequential updates to the same note might have occurred
                const currentBody = existing[key].body;

                const newBody = replaceEventBlockByKey(currentBody, uid, rid, block);

                const patch: Partial<Pick<NoteItem, 'body' | 'title' | 'parent_id'>> = {};
                const bodyChanged = newBody !== currentBody;
                const titleChanged = desiredTitle !== title;
                const parentChanged = !!options.targetFolderId && parent_id !== options.targetFolderId;

                if (bodyChanged) {
                    patch.body = newBody;
                }

                if (titleChanged) {
                    patch.title = desiredTitle;
                }

                if (parentChanged) {
                    patch.parent_id = options.targetFolderId;
                }

                if (bodyChanged || titleChanged || parentChanged) {
                    await updateNote(joplin, id, patch);
                    updated++;

                    // Publish the candidate state only after Joplin confirms the note-level write.
                    publishCommittedNoteState(existing, noteIdToKeys, id, patch);
                } else {
                    skipped++;
                }

                importedEventNotes[key] = {id, parent_id: (options.targetFolderId || parent_id), title: desiredTitle};
            } catch (e) {
                errors++;
                issues++;
                err('icsImportService', `ERROR updating note: ${key} - ${getErrorText(e)}`);
            }
        } else {
            pendingCreates.push({key, desiredTitle, block});
        }
    }

    await runWithConcurrency(pendingCreates, CREATE_NOTES_CONCURRENCY, async (item) => {
        try {
            const noteBody = {title: item.desiredTitle, body: item.block, parent_id: options.targetFolderId};
            const created = await createNote(joplin, noteBody);
            added++;
            if (created?.id) {
                importedEventNotes[item.key] = {
                    id: created.id,
                    parent_id: options.targetFolderId,
                    title: item.desiredTitle
                };
            }
        } catch (e) {
            errors++;
            issues++;
            err('icsImportService', `ERROR creating note: ${item.key} - ${getErrorText(e)}`);
        }
    });

    const alarmRes = await syncAlarmsForEvents(
        joplin, events, importedEventNotes, existingAlarms, options.targetFolderId, onStatus, {
            alarmRangeDays: options.importAlarmRangeDays,
            alarmsEnabled
        }
    );

    return {
        added,
        updated,
        skipped,
        errors,
        alarmsCreated: alarmRes.alarmsCreated,
        alarmsDeleted: alarmRes.alarmsDeleted,
        alarmsUpdated: alarmRes.alarmsUpdated,
        issues: issues + alarmRes.issues,
        ...((duplicateOwnershipWarnings.length || preparationWarnings.length || alarmRes.warnings.length)
            ? {warnings: [...duplicateOwnershipWarnings, ...preparationWarnings, ...alarmRes.warnings]}
            : {}),
    };
}
