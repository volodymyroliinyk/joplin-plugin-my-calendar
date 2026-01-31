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

export type AlarmSyncOptions = {
    /**
     * For deterministic testing. Defaults to new Date().
     */
    now?: Date;
    /**
     * Overrides settings.getIcsImportAlarmRangeDays().
     */
    alarmRangeDays?: number;
    /**
     * Overrides settings.getIcsImportEmptyTrashAfter().
     */
    emptyTrashAfter?: boolean;
};

function isPositiveFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function buildDesiredAlarmsForEvent(ev: IcsEvent, now: Date, windowEnd: Date): DesiredAlarm[] {
    const desired: DesiredAlarm[] = [];
    const nowMs = now.getTime();
    const windowEndMs = windowEnd.getTime();

    if (!ev.valarms || ev.valarms.length === 0) return desired;

    const occs = expandOccurrences(ev, now, windowEnd);
    for (const occ of occs) {
        for (const a of ev.valarms) {
            const when = computeAlarmWhen(a, occ);
            if (!when) continue;

            const whenMs = when.getTime();
            if (whenMs >= nowMs && whenMs <= windowEndMs) {
                desired.push({alarmTime: whenMs, eventTime: occ.start, trigger: a.trigger});
            }
        }
    }

    return desired;
}

function buildAlarmNoteBody(args: {
    eventTitle: string;
    eventTime: Date;
    eventNoteId: string;
    todoTitle: string;
    uid: string;
    rid: string;
    alarmTime: number;
    trigger: string;
}): string {
    const eventTimeStr = formatAlarmTitleTime(args.eventTime);
    const triggerDesc = formatTriggerDescription(args.trigger);
    return buildAlarmBody(
        args.eventTitle,
        eventTimeStr,
        args.eventNoteId,
        args.todoTitle,
        args.uid,
        args.rid,
        formatDateForAlarm(new Date(args.alarmTime)),
        triggerDesc
    );
}

export async function syncAlarmsForEvents(
    joplin: Joplin,
    events: IcsEvent[],
    importedEventNotes: Record<string, { id: string; parent_id?: string; title: string }>,
    existingAlarms: Record<string, ExistingAlarm[]>,
    targetFolderId?: string,
    onStatus?: (text: string) => Promise<void>,
    options?: number | AlarmSyncOptions
): Promise<AlarmSyncResult> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch { /* ignore */
        }
    };

    const resolvedOptions: AlarmSyncOptions = typeof options === 'number' ? {alarmRangeDays: options} : (options ?? {});

    const now = resolvedOptions.now ?? new Date();
    const nowMs = now.getTime();
    const alarmRangeDays = isPositiveFiniteNumber(resolvedOptions.alarmRangeDays) ? Math.round(resolvedOptions.alarmRangeDays) : await getIcsImportAlarmRangeDays(joplin);

    const emptyTrashAfter = typeof resolvedOptions.emptyTrashAfter === 'boolean' ? resolvedOptions.emptyTrashAfter : await getIcsImportEmptyTrashAfter(joplin);

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

        const desiredAlarms = buildDesiredAlarmsForEvent(ev, now, windowEnd);

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
                const eventTitle = ev.title || 'Event';
                const todoTitle = `${eventTitle} + ${formatAlarmTitleTime(eventTime)}`;
                const newBody = buildAlarmNoteBody({
                    eventTitle,
                    eventTime,
                    eventNoteId: eventNote.id,
                    todoTitle,
                    uid,
                    rid,
                    alarmTime,
                    trigger
                });

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
            const eventTitle = ev.title || 'Event';
            const todoTitle = `${eventTitle} + ${formatAlarmTitleTime(eventTime)}`;
            const body = buildAlarmNoteBody({
                eventTitle,
                eventTime,
                eventNoteId: eventNote.id,
                todoTitle,
                uid,
                rid,
                alarmTime,
                trigger
            });

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
                    // NOTE: Keeping this as a safety measure in case Joplin doesn't persist todo_due on create reliably.
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
