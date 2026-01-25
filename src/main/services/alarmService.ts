// src/main/services/alarmService.ts

import {IcsEvent} from '../types/icsTypes';
import {expandOccurrences} from './occurrenceService';
import {computeAlarmWhen, formatAlarmTitleTime, formatDateForAlarm, addDays} from '../utils/dateTimeUtils';
import {sanitizeForMarkdownBlock} from './noteBuilder';
import {makeEventKey} from '../utils/joplinUtils';
import {getIcsImportAlarmRangeDays} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {createNote, deleteNote, updateNote} from './joplinNoteService';

export type AlarmSyncResult = {
    alarmsCreated: number;
    alarmsDeleted: number;
};

export async function syncAlarmsForEvents(
    joplin: Joplin,
    events: IcsEvent[],
    importedEventNotes: Record<string, { id: string; parent_id?: string; title: string }>,
    existingAlarms: Record<string, string[]>,
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
    const alarmRangeDays =
        Number.isFinite(importAlarmRangeDays) && (importAlarmRangeDays as number) > 0
            ? Math.round(importAlarmRangeDays as number)
            : await getIcsImportAlarmRangeDays(joplin);

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

        // 1) Delete old alarms for this event
        const oldAlarmIds = existingAlarms[key] || [];
        for (const alarmId of oldAlarmIds) {
            try {
                await deleteNote(joplin, alarmId);
                alarmsDeleted++;
            } catch (e) {
                await say(`ERROR delete alarm: ${key} - ${String((e as any)?.message || e)}`);
            }
        }

        if (!ev.valarms || !ev.valarms.length) continue;

        // 2) Expand occurrences and create new alarms
        const occs = expandOccurrences(ev, now, windowEnd);

        for (const occ of occs) {
            for (const a of ev.valarms) {
                const when = computeAlarmWhen(a, occ);
                if (!when) continue;

                const whenMs = when.getTime();
                if (whenMs < now.getTime() || whenMs > windowEnd.getTime()) continue;

                const titleTime = formatAlarmTitleTime(when);
                const todoTitle = `${(ev.title || 'Event')} + ${titleTime}`;

                const body = [
                    '```mycalendar-alarm',
                    `title: ${sanitizeForMarkdownBlock(todoTitle).slice(0, 500)}`,
                    `uid: ${sanitizeForMarkdownBlock(uid)}`,
                    `recurrence_id: ${sanitizeForMarkdownBlock(rid)}`,
                    `when: ${formatDateForAlarm(new Date(whenMs))}`,
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
    }

    if (alarmsDeleted || alarmsCreated) {
        await say(`Alarms: deleted ${alarmsDeleted}, created ${alarmsCreated} (next ${alarmRangeDays} days)`);
    }

    return {alarmsCreated, alarmsDeleted};
}
