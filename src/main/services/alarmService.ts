// src/main/services/alarmService.ts

import {IcsEvent} from '../types/icsTypes';
import {expandOccurrences} from './occurrenceService';
import {
    computeAlarmAt,
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
import {log} from '../utils/logger';

export type AlarmSyncResult = {
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
};

export type ExistingAlarm = {
    id: string;
    todo_due: number;
    todo_completed: number;
    is_todo: number;
    body: string;
    title: string;
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
    /**
     * If false, no new alarms will be created, and existing ones will be deleted.
     * Defaults to true.
     */
    alarmsEnabled?: boolean;
};

function isNonNegativeFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function buildDesiredAlarmsForEvent(ev: IcsEvent, now: Date, windowEnd: Date): DesiredAlarm[] {
    const desired: DesiredAlarm[] = [];
    const nowMs = now.getTime();
    const windowEndMs = windowEnd.getTime();

    if (!ev.valarms || ev.valarms.length === 0) return desired;

    const occs = expandOccurrences(ev, now, windowEnd);
    for (const occ of occs) {
        for (const a of ev.valarms) {
            const alarmAt = computeAlarmAt(a, occ);
            if (!alarmAt) continue;

            const alarmAtMs = alarmAt.getTime();
            if (alarmAtMs >= nowMs && alarmAtMs <= windowEndMs) {
                desired.push({alarmTime: alarmAtMs, eventTime: occ.start, trigger: a.trigger});
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
    options?: number | AlarmSyncOptions,
    // Legacy argument support (if needed, though we prefer options object)
    legacyAlarmsEnabled?: boolean
): Promise<AlarmSyncResult> {
    const say = async (t: string) => {
        try {
            if (onStatus) await onStatus(t);
        } catch { /* ignore */
        }
    };

    const resolvedOptions: AlarmSyncOptions = typeof options === 'number' ? {alarmRangeDays: options} : (options ?? {});

    // Handle legacy argument if provided and options didn't specify it
    if (legacyAlarmsEnabled !== undefined && resolvedOptions.alarmsEnabled === undefined) {
        resolvedOptions.alarmsEnabled = legacyAlarmsEnabled;
    }

    const now = resolvedOptions.now ?? new Date();
    const nowMs = now.getTime();
    const alarmRangeDays = isNonNegativeFiniteNumber(resolvedOptions.alarmRangeDays) ? Math.trunc(resolvedOptions.alarmRangeDays) : await getIcsImportAlarmRangeDays(joplin);


    const emptyTrashAfter = typeof resolvedOptions.emptyTrashAfter === 'boolean' ? resolvedOptions.emptyTrashAfter : await getIcsImportEmptyTrashAfter(joplin);

    const alarmsEnabled = resolvedOptions.alarmsEnabled !== false; // Default true

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

        // If alarms are disabled, desiredAlarms is empty -> all existing will be deleted
        const desiredAlarms = alarmsEnabled ? buildDesiredAlarmsForEvent(ev, now, windowEnd) : [];

        const oldAlarms = existingAlarms[key] || [];
        const matchedDesiredIndices = new Set<number>();

        for (const alarm of oldAlarms) {
            // 1. Delete if too old (e.g. > 24h past)
            if (alarm.todo_due < nowMs - 24 * 60 * 60 * 1000) {
                try {
                    await deleteNote(joplin, alarm.id);
                    alarmsDeleted++;
                } catch (e) {
                    await say(`[alarmService] ERROR deleting outdated alarm: ${key} - ${String((e as any)?.message || e)}`);
                }
                continue;
            }

            // 2. Keep recent past alarms (do not delete, do not match against future desired alarms)
            if (alarm.todo_due < nowMs) {
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
                const triggerDesc = formatTriggerDescription(trigger);
                const todoTitle = `🔔  ${eventTitle} - ${formatAlarmTitleTime(eventTime)} (${triggerDesc})`;
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

                const isTodo = alarm.is_todo === 1;
                const titleChanged = alarm.title !== todoTitle;
                const bodyChanged = alarm.body !== newBody;

                if (bodyChanged || titleChanged || !isTodo) {
                    try {
                        const patch: any = {};
                        if (bodyChanged) patch.body = newBody;
                        if (titleChanged) patch.title = todoTitle;
                        if (!isTodo) {
                            patch.is_todo = 1;
                            patch.todo_completed = 0;
                        }

                        await updateNote(joplin, alarm.id, patch);
                        alarmsUpdated++;
                        log('alarmService', `Updated alarm: ${todoTitle}`);
                    } catch (e) {
                        await say(`[alarmService] ERROR updating alarm: ${key} - ${String((e as any)?.message || e)}`);
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
            const triggerDesc = formatTriggerDescription(trigger);
            const todoTitle = `🔔 ${eventTitle} - ${formatAlarmTitleTime(eventTime)} (${triggerDesc})`;
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
                    todo_completed: 0,
                };

                const created = await createNote(joplin, noteBody);
                if (created?.id) {
                    // NOTE: Keeping this as a safety measure in case Joplin doesn't persist todo_due on create reliably.
                    await updateNote(joplin, created.id, {
                        todo_due: alarmTime,
                        todo_completed: 0,
                        is_todo: 1,
                    });
                }
                alarmsCreated++;
                log('alarmService', `Created alarm: ${todoTitle} due ${new Date(alarmTime).toISOString()}`);
            } catch (e) {
                await say(`[alarmService] ERROR creating alarm: ${key} - ${String((e as any)?.message || e)}`);
            }
        }
    }

    if (alarmsDeleted > 0 && emptyTrashAfter) {
        try {
            await joplin.commands.execute('emptyTrash');
            await say('Trash emptied.');
        } catch (e) {
            await say(`[alarmService] WARNING: Failed to empty trash: ${String((e as any)?.message || e)}`);
        }
    }

    if (alarmsDeleted || alarmsCreated || alarmsUpdated) {
        await say(`Alarms sync summary: deleted ${alarmsDeleted}, created ${alarmsCreated}, updated ${alarmsUpdated} (next ${alarmRangeDays} days)`);
    }

    return {alarmsCreated, alarmsDeleted, alarmsUpdated};
}
