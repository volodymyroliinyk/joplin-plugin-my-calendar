// src/main/services/alarmService.ts

import {IcsEvent} from '../types/icsTypes';
import {expandOccurrences} from './occurrenceService';
import {
    computeAlarmWhen,
    formatAlarmTitleTime,
    formatDateForAlarm,
    addDays,
    formatTriggerDescription
} from '../utils/dateTimeUtils';
import {buildAlarmBody} from './noteBuilder';
import {makeEventKey} from '../utils/joplinUtils';
import {getIcsImportAlarmRangeDays, getIcsImportEmptyTrashAfter} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {createNote, deleteNote, updateNote} from './joplinNoteService';

export type AlarmSyncResult = {
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
};

export type ExistingAlarm = {
    id: string;
    todo_due: number;
    body: string;
};

type DesiredAlarm = {
    alarmTime: number;
    eventTime: Date;
    trigger: string;
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
    let alarmsUpdated = 0;

    for (const ev of events) {
        const uid = (ev.uid || '').trim();
        if (!uid) continue;
        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        const eventNote = importedEventNotes[key];
        if (!eventNote) continue;

        const notebookId = targetFolderId || eventNote.parent_id;
        if (!notebookId) continue;

        const desiredAlarms: DesiredAlarm[] = [];

        if (ev.valarms && ev.valarms.length > 0) {
            const occs = expandOccurrences(ev, now, windowEnd);
            for (const occ of occs) {
                for (const a of ev.valarms) {
                    const when = computeAlarmWhen(a, occ);
                    if (!when) continue;

                    const whenMs = when.getTime();
                    if (whenMs >= nowMs && whenMs <= windowEnd.getTime()) {
                        desiredAlarms.push({
                            alarmTime: whenMs,
                            eventTime: occ.start,
                            trigger: a.trigger
                        });
                    }
                }
            }
        }

        const oldAlarms = existingAlarms[key] || [];
        const matchedDesiredIndices = new Set<number>();

        for (const alarm of oldAlarms) {
            if (alarm.todo_due < nowMs) {
                try {
                    await deleteNote(joplin, alarm.id);
                    alarmsDeleted++;
                } catch (e) {
                    await say(`[alarmService] ERROR deleting outdated alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
                continue;
            }

            let matchIndex = -1;
            for (let i = 0; i < desiredAlarms.length; i++) {
                if (!matchedDesiredIndices.has(i)) {
                    if (Math.abs(desiredAlarms[i].alarmTime - alarm.todo_due) < 1000) {
                        matchIndex = i;
                        break;
                    }
                }
            }

            if (matchIndex !== -1) {
                matchedDesiredIndices.add(matchIndex);
                const {alarmTime, eventTime, trigger} = desiredAlarms[matchIndex];
                const eventTimeStr = formatAlarmTitleTime(eventTime);
                const todoTitle = `${(ev.title || 'Event')} + ${eventTimeStr}`;
                const triggerDesc = formatTriggerDescription(trigger);
                const newBody = buildAlarmBody(
                    ev.title || 'Event',
                    eventTimeStr,
                    eventNote.id,
                    todoTitle,
                    uid,
                    rid,
                    formatDateForAlarm(new Date(alarmTime)),
                    triggerDesc
                );

                if (newBody !== alarm.body) {
                    try {
                        await updateNote(joplin, alarm.id, {body: newBody});
                        alarmsUpdated++;
                    } catch (e) {
                        await say(`[alarmService] ERROR updating alarm body: ${key} - ${String((e as any)?.message || e)}`);
                    }
                }
            } else {
                try {
                    await deleteNote(joplin, alarm.id);
                    alarmsDeleted++;
                } catch (e) {
                    await say(`[alarmService] ERROR deleting invalid alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
            }
        }

        for (let i = 0; i < desiredAlarms.length; i++) {
            if (matchedDesiredIndices.has(i)) continue;

            const {alarmTime, eventTime, trigger} = desiredAlarms[i];
            const when = new Date(alarmTime);

            const eventTimeStr = formatAlarmTitleTime(eventTime);
            const todoTitle = `${(ev.title || 'Event')} + ${eventTimeStr}`;
            const triggerDesc = formatTriggerDescription(trigger);

            const body = buildAlarmBody(
                ev.title || 'Event',
                eventTimeStr,
                eventNote.id,
                todoTitle,
                uid,
                rid,
                formatDateForAlarm(when),
                triggerDesc
            );

            try {
                const noteBody = {
                    title: todoTitle,
                    body,
                    parent_id: notebookId,
                    is_todo: 1,
                    todo_due: alarmTime,
                };

                const created = await createNote(joplin, noteBody);
                if (created?.id) {
                    await updateNote(joplin, created.id, {todo_due: alarmTime});
                }
                alarmsCreated++;
            } catch (e) {
                await say(`[alarmService] ERROR creating alarm: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    if (alarmsDeleted > 0 && emptyTrashAfter) {
        try {
            await joplin.commands.execute('emptyTrash');
            await say('[alarmService] Trash emptied.');
        } catch (e) {
            await say(`[alarmService] WARNING: Failed to empty trash: ${String((e as any)?.message || e)}`);
        }
    }

    if (alarmsDeleted || alarmsCreated || alarmsUpdated) {
        await say(`[alarmService] Alarms sync summary: deleted ${alarmsDeleted}, created ${alarmsCreated}, updated ${alarmsUpdated} (next ${alarmRangeDays} days)`);
    }

    return {alarmsCreated, alarmsDeleted, alarmsUpdated};
}
