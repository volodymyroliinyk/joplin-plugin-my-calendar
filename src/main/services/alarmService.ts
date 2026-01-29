// src/main/services/alarmService.ts

import {IcsEvent} from '../types/icsTypes';
import {expandOccurrences} from './occurrenceService';
import {computeAlarmWhen, formatAlarmTitleTime, formatDateForAlarm, addDays} from '../utils/dateTimeUtils';
import {sanitizeForMarkdownBlock} from './noteBuilder';
import {makeEventKey} from '../utils/joplinUtils';
import {getIcsImportAlarmRangeDays, getIcsImportEmptyTrashAfter} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {createNote, deleteNote, updateNote} from './joplinNoteService';

export type AlarmSyncResult = {
    alarmsCreated: number;
    alarmsDeleted: number;
};

export type ExistingAlarm = {
    id: string;
    todo_due: number;
};

export async function syncAlarmsForEvents(
    joplin: Joplin,
    events: IcsEvent[],
    importedEventNotes: Record<string, { id: string; parent_id?: string; title: string }>,
    existingAlarms: Record<string, ExistingAlarm[]>,
    targetFolderId?: string,
    onStatus?: (text: string) => Promise<void>,
    importAlarmRangeDays?: number
): Promise<AlarmSyncResult> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch { /* ignore */
        }
    };

    const now = new Date();
    const nowMs = now.getTime();
    const alarmRangeDays =
        Number.isFinite(importAlarmRangeDays) && (importAlarmRangeDays as number) > 0
            ? Math.round(importAlarmRangeDays as number)
            : await getIcsImportAlarmRangeDays(joplin);

    const emptyTrashAfter = await getIcsImportEmptyTrashAfter(joplin);

    const windowEnd = addDays(now, alarmRangeDays);

    let alarmsDeleted = 0;
    let alarmsCreated = 0;

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) continue;
        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        const eventNote = importedEventNotes[key];
        if (!eventNote) continue;

        const notebookId = targetFolderId || eventNote.parent_id;
        if (!notebookId) continue;

        // --- Step 1: Calculate all DESIRED alarms for this event in the future window ---
        const desiredAlarms: number[] = []; // list of timestamps (ms)

        if (ev.valarms && ev.valarms.length > 0) {
            const occs = expandOccurrences(ev, now, windowEnd);
            for (const occ of occs) {
                for (const a of ev.valarms) {
                    const when = computeAlarmWhen(a, occ);
                    if (!when) continue;

                    const whenMs = when.getTime();
                    // Only care about alarms in the future (or very recent past if we want to be safe, but usually future)
                    // The requirement says: "delete outdated alarms".
                    // "outdated" usually means < now.
                    // So we only generate desired alarms >= now.
                    if (whenMs >= nowMs && whenMs <= windowEnd.getTime()) {
                        desiredAlarms.push(whenMs);
                    }
                }
            }
        }

        // --- Step 2: Process existing alarms ---
        const oldAlarms = existingAlarms[key] || [];
        const matchedDesiredIndices = new Set<number>();

        for (const alarm of oldAlarms) {
            // A) Is it outdated?
            if (alarm.todo_due < nowMs) {
                // Outdated -> Delete
                try {
                    await deleteNote(joplin, alarm.id);
                    alarmsDeleted++;
                } catch (e) {
                    await say(`ERROR delete outdated alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
                continue;
            }

            // B) Is it still valid (matches a desired alarm)?
            // We look for a match in desiredAlarms that hasn't been matched yet.
            // We allow a small tolerance? No, usually exact match is expected for computer generated times.
            // But let's stick to exact match for simplicity.
            let matchIndex = -1;
            for (let i = 0; i < desiredAlarms.length; i++) {
                if (!matchedDesiredIndices.has(i)) {
                    // Check if timestamps match exactly
                    if (Math.abs(desiredAlarms[i] - alarm.todo_due) < 1000) { // 1 sec tolerance
                        matchIndex = i;
                        break;
                    }
                }
            }

            if (matchIndex !== -1) {
                // Found a match! Keep this alarm.
                matchedDesiredIndices.add(matchIndex);
                // We don't delete it.
            } else {
                // Not outdated, but not in our desired list (e.g. event time changed, or alarm removed from event)
                // -> Delete
                try {
                    await deleteNote(joplin, alarm.id);
                    alarmsDeleted++;
                } catch (e) {
                    await say(`ERROR delete invalid alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
            }
        }

        // --- Step 3: Create missing alarms ---
        for (let i = 0; i < desiredAlarms.length; i++) {
            if (matchedDesiredIndices.has(i)) continue; // Already exists

            const whenMs = desiredAlarms[i];
            const when = new Date(whenMs);

            const titleTime = formatAlarmTitleTime(when);
            const todoTitle = `${(ev.title || 'Event')} + ${titleTime}`;

            const body = [
                '```mycalendar-alarm',
                `title: ${sanitizeForMarkdownBlock(todoTitle).slice(0, 500)}`,
                `uid: ${sanitizeForMarkdownBlock(uid)}`,
                `recurrence_id: ${sanitizeForMarkdownBlock(rid)}`,
                `when: ${formatDateForAlarm(when)}`,
                '```',
                '',
                '---',
                '',
                `[${ev.title || 'Event'}](:/${eventNote.id})`,
                '',
            ].join('\n');

            try {
                const noteBody = {
                    title: todoTitle,
                    body,
                    parent_id: notebookId,
                    is_todo: 1,
                    todo_due: whenMs,
                };

                const created = await createNote(joplin, noteBody);
                if (created?.id) {
                    // Reliability: PUT to ensure alarm fields are set
                    await updateNote(joplin, created.id, {todo_due: whenMs});
                }
                alarmsCreated++;
            } catch (e) {
                await say(`ERROR create alarm: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    // Clean trash if enabled and alarms were deleted
    if (alarmsDeleted > 0 && emptyTrashAfter) {
        try {
            await joplin.commands.execute('emptyTrash');
            await say('Trash emptied.');
        } catch (e) {
            await say(`WARNING: Failed to empty trash: ${String((e as any)?.message || e)}`);
        }
    }

    if (alarmsDeleted || alarmsCreated) {
        await say(`Alarms: deleted ${alarmsDeleted}, created ${alarmsCreated} (next ${alarmRangeDays} days)`);
    }

    return {alarmsCreated, alarmsDeleted};
}
