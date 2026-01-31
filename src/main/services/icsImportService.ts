// src/main/services/icsImportService.ts

import {parseImportText} from '../parsers/icsParser';
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
import {createNote, getAllNotesPaged, updateNote} from './joplinNoteService';

type ExistingEventNote = { id: string; title: string; body: string; parent_id?: string };
type ExistingEventNoteMap = Record<string, ExistingEventNote>;
type ImportedEventNote = { id: string; parent_id?: string; title: string };
type ImportedEventNotes = Record<string, ImportedEventNote>;
type ExistingAlarmsMap = Record<string, ExistingAlarm[]>;
type NoteIdToKeysMap = Record<string, string[]>;

type ImportIcsResult = {
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
};

function safeStatus(onStatus?: (text: string) => Promise<void>) {
    return async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch { /* ignore */
        }
    };
}

function indexExistingNotes(allNotes: any[]): {
    existingByKey: ExistingEventNoteMap;
    existingAlarms: ExistingAlarmsMap;
    noteIdToKeys: NoteIdToKeysMap;
} {
    const existingByKey: ExistingEventNoteMap = {};
    const existingAlarms: ExistingAlarmsMap = {};
    const noteIdToKeys: NoteIdToKeysMap = {};

    for (const n of allNotes) {
        if (typeof n.body !== 'string' || !n.body) continue;

        if (n.body.includes('```mycalendar-event')) {
            const keys = extractAllEventKeysFromBody(n.body);
            if (keys.length) {
                noteIdToKeys[n.id] = (noteIdToKeys[n.id] ?? []).concat(keys);
            }
            for (const k of keys) {
                existingByKey[k] = {id: n.id, title: n.title || '', body: n.body, parent_id: n.parent_id};
            }
        }

        if (n.body.includes('```mycalendar-alarm')) {
            const metas = extractAllAlarmKeysFromBody(n.body);
            for (const meta of metas) {
                (existingAlarms[meta.key] ??= []).push({id: n.id, todo_due: n.todo_due || 0, body: n.body});
            }
        }
    }

    return {existingByKey, existingAlarms, noteIdToKeys};
}

function applyImportColors(
    ev: any,
    existing: ExistingEventNoteMap,
    preserveLocalColor: boolean,
    importDefaultColor?: string,
) {
    const uid = (ev.uid || '').trim();
    const rid = (ev.recurrence_id || '').trim();
    const key = makeEventKey(uid, rid);

    if (preserveLocalColor && existing[key] && !ev.color) {
        const existingColor = extractEventColorFromBody(existing[key].body, uid, rid);
        if (existingColor) ev.color = existingColor;
    }
    if (!ev.color && importDefaultColor) ev.color = importDefaultColor;
    return key;
}

export async function importIcsIntoNotes(
    joplin: Joplin,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    importDefaultColor?: string,
    importAlarmRangeDays?: number,
): Promise<ImportIcsResult> {
    const say = safeStatus(onStatus);

    const eventsRaw = parseImportText(ics);
    const events = eventsRaw.map(e => ({...e})); // avoid mutating parser output
    await say(`Parsed ${events.length} VEVENT(s)`);

    // Request todo_due to optimize alarm syncing
    const allNotes = await getAllNotesPaged(joplin, ['id', 'title', 'body', 'parent_id', 'todo_due']);

    const {existingByKey: existing, existingAlarms, noteIdToKeys} = indexExistingNotes(allNotes);

    let added = 0, updated = 0, skipped = 0, errors = 0;
    const importedEventNotes: ImportedEventNotes = {};

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) {
            skipped++;
            continue;
        }

        const rid = (ev.recurrence_id || '').trim();
        const key = applyImportColors(ev, existing, preserveLocalColor, importDefaultColor);

        const block = buildMyCalBlock(ev);
        const desiredTitle = ev.title || 'Event';

        if (existing[key]) {
            try {
                const {id, title, parent_id} = existing[key];
                // CRITICAL: Always use the LATEST body from our local "existing" cache
                // because multiple sequential updates to the same note might have occurred
                const currentBody = existing[key].body;

                const newBody = replaceEventBlockByKey(currentBody, uid, rid, block);

                const patch: any = {};
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

                if (targetFolderId && parent_id !== targetFolderId) {
                    patch.parent_id = targetFolderId;
                    existing[key].parent_id = targetFolderId;
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

                importedEventNotes[key] = {id, parent_id: (targetFolderId || parent_id), title: desiredTitle};
            } catch (e) {
                errors++;
                await say(`[icsImportService] ERROR updating note: ${key} - ${String((e as any)?.message || e)}`);
            }
        } else {
            try {
                const noteBody = {title: desiredTitle, body: block, parent_id: targetFolderId};
                const created = await createNote(joplin, noteBody);
                added++;
                if (created?.id) {
                    importedEventNotes[key] = {id: created.id, parent_id: targetFolderId, title: desiredTitle};
                }
            } catch (e) {
                errors++;
                await say(`[icsImportService] ERROR creating note: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    const alarmRes = await syncAlarmsForEvents(
        joplin, events, importedEventNotes, existingAlarms, targetFolderId, onStatus, importAlarmRangeDays
    );

    return {added, updated, skipped, errors, ...alarmRes};
}
