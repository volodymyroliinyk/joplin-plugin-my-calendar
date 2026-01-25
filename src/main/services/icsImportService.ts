// src/main/services/icsImportService.ts

import {parseImportText} from '../parsers/icsParser';
import {
    extractEventColorFromBody,
    makeEventKey,
    extractAllEventKeysFromBody,
    extractAllAlarmKeysFromBody,
    replaceEventBlockByKey
} from '../utils/joplinUtils';
import {syncAlarmsForEvents} from './alarmService';
import {buildMyCalBlock} from './noteBuilder';
import {Joplin} from '../types/joplin.interface';
import {createNote, getAllNotesPaged, updateNote} from './joplinNoteService';

export async function importIcsIntoNotes(
    joplin: Joplin,
    ics: string,
    onStatus?: (text: string) => Promise<void>,
    targetFolderId?: string,
    preserveLocalColor: boolean = true,
    importDefaultColor?: string,
    importAlarmRangeDays?: number,
): Promise<{
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number
}> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch { /* ignore */
        }
    };

    const events = parseImportText(ics);
    await say(`Parsed ${events.length} VEVENT(s)`);

    const existing: Record<string, { id: string; title: string; body: string; parent_id?: string }> = {};
    const existingAlarms: Record<string, string[]> = {};

    const allNotes = await getAllNotesPaged(joplin);

    for (const n of allNotes) {
        if (typeof n.body !== 'string' || !n.body) continue;
        if (n.body.includes('```mycalendar-event')) {
            const keys = extractAllEventKeysFromBody(n.body);
            for (const k of keys) {
                existing[k] = {id: n.id, title: n.title || '', body: n.body, parent_id: n.parent_id};
            }
        }
        if (n.body.includes('```mycalendar-alarm')) {
            const metas = extractAllAlarmKeysFromBody(n.body);
            for (const meta of metas) {
                (existingAlarms[meta.key] ??= []).push(n.id);
            }
        }
    }

    let added = 0, updated = 0, skipped = 0, errors = 0;
    const importedEventNotes: Record<string, { id: string; parent_id?: string; title: string }> = {};

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) {
            skipped++;
            continue;
        }

        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        if (preserveLocalColor && existing[key] && !ev.color) {
            const existingColor = extractEventColorFromBody(existing[key].body, uid, rid);
            if (existingColor) ev.color = existingColor;
        }
        if (!ev.color && importDefaultColor) ev.color = importDefaultColor;

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

                // IMPORTANT: update the cache for ANY event that points to this same note
                for (const k in existing) {
                    if (existing[k].id === id) {
                        existing[k].body = existing[key].body;
                    }
                }

                importedEventNotes[key] = {id, parent_id: (targetFolderId || parent_id), title: desiredTitle};
            } catch (e) {
                errors++;
                await say(`ERROR update: ${key} - ${String((e as any)?.message || e)}`);
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
                await say(`ERROR create: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    const alarmRes = await syncAlarmsForEvents(
        joplin, events, importedEventNotes, existingAlarms, targetFolderId, onStatus, importAlarmRangeDays
    );

    return {added, updated, skipped, errors, ...alarmRes};
}
