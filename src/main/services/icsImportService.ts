// src/main/services/icsImportService.ts

import {parseImportText} from '../parsers/icsParser';
import {IcsEvent} from '../types/icsTypes';
import {
    extractEventColorFromBody,
    makeEventKey,
    extractAllEventKeysFromBody,
    extractAllAlarmKeysFromBody,
    replaceEventBlockByKey
} from '../utils/joplinUtils';
import {syncAlarmsForEvents, ExistingAlarm} from './alarmService';
import {buildMyCalBlock} from './noteBuilder';
import {Joplin} from '../types/joplin.interface';
import {createNote, getAllNotesPaged, getFolderNotesPaged, NoteItem, updateNote} from './joplinNoteService';
import {getIcsImportAlarmsEnabled} from '../settings/settings';
import {getErrorText} from '../utils/errorUtils';
import {createSafeTextReporter} from '../utils/statusNotifier';

type ExistingEventNote = { id: string; title: string; body: string; parent_id?: string };
type ExistingEventNoteMap = Record<string, ExistingEventNote>;
type ImportedEventNote = { id: string; parent_id?: string; title: string };
type ImportedEventNotes = Record<string, ImportedEventNote>;
type ExistingAlarmsMap = Record<string, ExistingAlarm[]>;
type NoteIdToKeysMap = Record<string, string[]>;
type DuplicateOwnershipWarning = {
    key: string;
    existingNoteId: string;
    duplicateNoteId: string;
};
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
    existingNotesFolderId?: string;
};

function normalizeExceptionDate(value: string): string | undefined {
    const raw = String(value || '').trim();
    if (!raw) return undefined;

    const dateOnly = raw.match(/^DATE:(\d{8})$/i);
    if (dateOnly) {
        return `${dateOnly[1].slice(0, 4)}-${dateOnly[1].slice(4, 6)}-${dateOnly[1].slice(6, 8)} 00:00:00`;
    }

    const tzPrefixed = raw.match(/^[^:]+:(\d{8}T\d{6}Z?)$/);
    if (tzPrefixed) {
        const dt = tzPrefixed[1];
        if (/Z$/i.test(dt)) {
            return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}+00:00`;
        }
        return `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)} ${dt.slice(9, 11)}:${dt.slice(11, 13)}:${dt.slice(13, 15)}`;
    }

    const plainDateTime = raw.match(/^(\d{8})T(\d{6}Z?)$/);
    if (plainDateTime) {
        const date = plainDateTime[1];
        const time = plainDateTime[2];
        if (/Z$/i.test(time)) {
            return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}+00:00`;
        }
        return `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)} ${time.slice(0, 2)}:${time.slice(2, 4)}:${time.slice(4, 6)}`;
    }

    return raw;
}

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

function prepareImportedEvents(eventsRaw: IcsEvent[]): IcsEvent[] {
    const events = eventsRaw.map((e) => ({
        ...e,
        exdates: Array.isArray(e.exdates) ? [...e.exdates] : undefined,
        valarms: Array.isArray(e.valarms) ? e.valarms.map((alarm) => ({...alarm})) : undefined,
    }));

    const mastersByUid = new Map<string, IcsEvent>();
    for (const ev of events) {
        const uid = String(ev.uid || '').trim();
        if (!uid || ev.recurrence_id) continue;
        if (!mastersByUid.has(uid)) {
            mastersByUid.set(uid, ev);
        }
    }

    const prepared: IcsEvent[] = [];
    for (const ev of events) {
        const uid = String(ev.uid || '').trim();
        const rid = String(ev.recurrence_id || '').trim();
        if (uid && rid) {
            pushUniqueExdate(mastersByUid.get(uid), normalizeExceptionDate(rid));
        }

        if (String(ev.status || '').trim().toLowerCase() === 'cancelled') {
            continue;
        }

        prepared.push(ev);
    }

    return prepared;
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
                        key: k,
                        existingNoteId: existingOwner.id,
                        duplicateNoteId: n.id,
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
    const events = prepareImportedEvents(eventsRaw);
    await say(`Parsed ${events.length} VEVENT(s)`);

    const noteFields = ['id', 'title', 'body', 'parent_id', 'todo_due', 'todo_completed', 'is_todo'];
    const allNotes = options.existingNotesFolderId
        ? await getFolderNotesPaged(joplin, options.existingNotesFolderId, noteFields)
        : await getAllNotesPaged(joplin, noteFields);
    allNotes.sort(compareExistingNotesForOwnership);

    const {
        existingByKey: existing,
        existingAlarms,
        noteIdToKeys,
        duplicateOwnershipWarnings,
    } = indexExistingNotes(allNotes);

    for (const warning of duplicateOwnershipWarnings) {
        await say(
            `[icsImportService] WARNING: Duplicate event ownership detected for ${warning.key} in notes ${warning.existingNoteId} and ${warning.duplicateNoteId}; keeping lexicographically smallest note id ${warning.existingNoteId}`,
        );
    }

    let alarmsEnabled = false;
    try {
        alarmsEnabled = await getIcsImportAlarmsEnabled(joplin);
    } catch (e) {
        await say(`[icsImportService] WARNING: Failed to read alarms setting; defaulting to disabled. ${getErrorText(e)}`);
    }

    let added = 0, updated = 0, skipped = 0, errors = 0;
    const importedEventNotes: ImportedEventNotes = {};

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
                let changedAtAll = false;

                if (newBody !== currentBody) {
                    patch.body = newBody;
                    // Update our cache immediately so the next event in the same note sees current state
                    existing[key].body = newBody;
                    changedAtAll = true;
                }

                if (desiredTitle !== title) {
                    patch.title = desiredTitle;
                    existing[key].title = desiredTitle;
                    changedAtAll = true;
                }

                if (options.targetFolderId && parent_id !== options.targetFolderId) {
                    patch.parent_id = options.targetFolderId;
                    existing[key].parent_id = options.targetFolderId;
                    changedAtAll = true;
                }

                if (changedAtAll) {
                    await updateNote(joplin, id, patch);
                    updated++;
                } else {
                    skipped++;
                }

                // IMPORTANT: update cache for all keys in the same note (O(keysInNote) instead of O(allKeys))
                const keysInSameNote = noteIdToKeys[id] ?? [];
                for (const k of keysInSameNote) {
                    if (existing[k]) existing[k].body = existing[key].body;
                }

                importedEventNotes[key] = {id, parent_id: (options.targetFolderId || parent_id), title: desiredTitle};
            } catch (e) {
                errors++;
                await say(`[icsImportService] ERROR updating note: ${key} - ${getErrorText(e)}`);
            }
        } else {
            try {
                const noteBody = {title: desiredTitle, body: block, parent_id: options.targetFolderId};
                const created = await createNote(joplin, noteBody);
                added++;
                if (created?.id) {
                    importedEventNotes[key] = {id: created.id, parent_id: options.targetFolderId, title: desiredTitle};
                }
            } catch (e) {
                errors++;
                await say(`[icsImportService] ERROR creating note: ${key} - ${getErrorText(e)}`);
            }
        }
    }


    const alarmRes = await syncAlarmsForEvents(
        joplin, events, importedEventNotes, existingAlarms, options.targetFolderId, onStatus, {
            alarmRangeDays: options.importAlarmRangeDays,
            alarmsEnabled
        }
    );

    return {added, updated, skipped, errors, ...alarmRes};
}
