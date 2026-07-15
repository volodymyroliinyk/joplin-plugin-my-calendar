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
import {
    getIcsImportAlarmEmoji,
    getIcsImportAlarmRangeDays
} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {createNote, deleteNote, NoteItem, updateNote} from './joplinNoteService';
import {err, log} from '../utils/logger';
import {getErrorText} from '../utils/errorUtils';
import {createSafeTextReporter} from '../utils/statusNotifier';
import {normalizeIcsEvent} from './calendarEventNormalizer';

export type AlarmSyncResult = {
    alarmsCreated: number;
    alarmsDeleted: number;
    alarmsUpdated: number;
    issues: number;
    warnings: AlarmSyncWarning[];
};

export type AlarmSyncWarning = {
    code: 'valarm_limit_exceeded' | 'desired_alarm_limit_exceeded';
    key?: string;
    limit: number;
    discarded?: number;
    message: string;
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

type AlarmUpdatePatch = Partial<Pick<NoteItem, 'body' | 'title' | 'is_todo' | 'todo_completed' | 'todo_due'>>;

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
     * If false, no new alarms will be created, and existing ones will be deleted.
     * Defaults to true.
     */
    alarmsEnabled?: boolean;
    /**
     * Overrides settings.getIcsImportAlarmEmoji().
     */
    alarmEmoji?: string;
};

const ALARM_OPS_CONCURRENCY = 6;
export const MAX_VALARMS_PER_EVENT = 16;
export const MAX_DESIRED_ALARMS_PER_IMPORT = 2_000;
const ALARM_TIMESTAMP_RESOLUTION_MS = 1_000;

function isNonNegativeFiniteNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function buildDesiredAlarmsForEvent(
    ev: IcsEvent,
    now: Date,
    windowEnd: Date,
    limit: number,
): { desired: DesiredAlarm[]; truncated: boolean } {
    const desired: DesiredAlarm[] = [];
    const nowMs = now.getTime();
    const windowEndMs = windowEnd.getTime();

    if (!ev.valarms || ev.valarms.length === 0) return {desired, truncated: false};
    if (limit <= 0) return {desired, truncated: true};

    const occs = expandOccurrences(ev, now, windowEnd);
    for (const occ of occs) {
        for (const a of ev.valarms.slice(0, MAX_VALARMS_PER_EVENT)) {
            const alarmAt = computeAlarmAt(a, occ);
            if (!alarmAt) continue;

            const alarmAtMs = alarmAt.getTime();
            if (alarmAtMs >= nowMs && alarmAtMs <= windowEndMs) {
                if (desired.length >= limit) return {desired, truncated: true};
                desired.push({alarmTime: alarmAtMs, eventTime: occ.start, trigger: a.trigger});
            }
        }
    }

    return {desired, truncated: false};
}

function normalizedAlarmTimestamp(timestamp: number): number {
    return Math.round(timestamp / ALARM_TIMESTAMP_RESOLUTION_MS) * ALARM_TIMESTAMP_RESOLUTION_MS;
}

function indexDesiredAlarms(desired: DesiredAlarm[]): Map<number, number[]> {
    const indexed = new Map<number, number[]>();
    desired.forEach((alarm, index) => {
        const timestamp = normalizedAlarmTimestamp(alarm.alarmTime);
        const queue = indexed.get(timestamp);
        if (queue) queue.push(index);
        else indexed.set(timestamp, [index]);
    });
    return indexed;
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

function buildAlarmTodoTitle(alarmEmoji: string, eventTitle: string, eventTime: Date, trigger: string): string {
    const prefix = alarmEmoji.trim();
    const triggerDesc = formatTriggerDescription(trigger);
    return prefix
        ? `${prefix} ${eventTitle} - ${formatAlarmTitleTime(eventTime)} (${triggerDesc})`
        : `${eventTitle} - ${formatAlarmTitleTime(eventTime)} (${triggerDesc})`;
}

async function runWithConcurrency(
    tasks: Array<() => Promise<void>>,
    concurrency: number,
): Promise<void> {
    const limit = Math.max(1, Math.trunc(concurrency) || 1);
    let nextIndex = 0;

    const consume = async (): Promise<void> => {
        while (true) {
            const currentIndex = nextIndex++;
            if (currentIndex >= tasks.length) return;
            await tasks[currentIndex]();
        }
    };

    const workers = Array.from({length: Math.min(limit, tasks.length)}, () => consume());
    await Promise.all(workers);
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
    const say = createSafeTextReporter(onStatus);

    const resolvedOptions: AlarmSyncOptions = typeof options === 'number' ? {alarmRangeDays: options} : (options ?? {});

    // Handle legacy argument if provided and options didn't specify it
    if (legacyAlarmsEnabled !== undefined && resolvedOptions.alarmsEnabled === undefined) {
        resolvedOptions.alarmsEnabled = legacyAlarmsEnabled;
    }

    const now = resolvedOptions.now ?? new Date();
    const nowMs = now.getTime();
    const alarmRangeDays = isNonNegativeFiniteNumber(resolvedOptions.alarmRangeDays) ? Math.trunc(resolvedOptions.alarmRangeDays) : await getIcsImportAlarmRangeDays(joplin);


    const alarmEmoji = typeof resolvedOptions.alarmEmoji === 'string' ? resolvedOptions.alarmEmoji.trim() : await getIcsImportAlarmEmoji(joplin);

    const alarmsEnabled = resolvedOptions.alarmsEnabled !== false; // Default true

    const windowEnd = addDays(now, alarmRangeDays);

    let alarmsDeleted = 0;
    let alarmsCreated = 0;
    let alarmsUpdated = 0;
    let issues = 0;
    const warnings: AlarmSyncWarning[] = [];
    let desiredAlarmCount = 0;
    let desiredLimitReported = false;
    const pendingOps: Array<() => Promise<void>> = [];

    for (const input of events) {
        const ev = normalizeIcsEvent(input);
        const uid = (ev.uid || '').trim();
        if (!uid) continue;
        const rid = (ev.recurrence_id || '').trim();
        const key = makeEventKey(uid, rid);

        const eventNote = importedEventNotes[key];
        if (!eventNote) continue;

        const oldAlarms = existingAlarms[key] || [];
        if (!alarmsEnabled) {
            for (const alarm of oldAlarms) {
                pendingOps.push(async () => {
                    try {
                        await deleteNote(joplin, alarm.id);
                        alarmsDeleted++;
                    } catch (e) {
                        issues++;
                        err('alarmService', `ERROR deleting disabled alarm: ${key} - ${getErrorText(e)}`);
                    }
                });
            }
            continue;
        }

        const notebookId = targetFolderId || eventNote.parent_id;
        if (!notebookId) continue;

        const valarmCount = ev.valarms?.length ?? 0;
        if (valarmCount > MAX_VALARMS_PER_EVENT) {
            const discarded = valarmCount - MAX_VALARMS_PER_EVENT;
            issues++;
            warnings.push({
                code: 'valarm_limit_exceeded',
                key,
                limit: MAX_VALARMS_PER_EVENT,
                discarded,
                message: `Event ${key} has too many VALARMs; ignored ${discarded} after the first ${MAX_VALARMS_PER_EVENT}`,
            });
        }

        const remainingDesiredCapacity = MAX_DESIRED_ALARMS_PER_IMPORT - desiredAlarmCount;
        const {desired: desiredAlarms, truncated} = buildDesiredAlarmsForEvent(
            ev,
            now,
            windowEnd,
            remainingDesiredCapacity,
        );
        desiredAlarmCount += desiredAlarms.length;
        if (truncated && !desiredLimitReported) {
            desiredLimitReported = true;
            issues++;
            warnings.push({
                code: 'desired_alarm_limit_exceeded',
                key,
                limit: MAX_DESIRED_ALARMS_PER_IMPORT,
                message: `Alarm import limit ${MAX_DESIRED_ALARMS_PER_IMPORT} reached; ignored alarms for event ${key}`,
            });
        }

        const matchedDesiredIndices = new Set<number>();
        const desiredByTimestamp = indexDesiredAlarms(desiredAlarms);

        for (const alarm of oldAlarms) {
            const isCompleted = alarm.todo_completed > 0;

            // 1. Delete completed alarms if too old (e.g. > 24h past)
            if (alarm.todo_due < nowMs - 24 * 60 * 60 * 1000) {
                if (isCompleted) {
                    pendingOps.push(async () => {
                        try {
                            await deleteNote(joplin, alarm.id);
                            alarmsDeleted++;
                        } catch (e) {
                            issues++;
                            err('alarmService', `ERROR deleting outdated alarm: ${key} - ${getErrorText(e)}`);
                        }
                    });
                }
                continue;
            }

            // 2. Keep recent past alarms (do not delete, do not match against future desired alarms)
            if (alarm.todo_due < nowMs) {
                continue;
            }

            const queue = desiredByTimestamp.get(normalizedAlarmTimestamp(alarm.todo_due));
            const matchIndex = queue?.shift() ?? -1;

            if (matchIndex !== -1) {
                matchedDesiredIndices.add(matchIndex);
                const {alarmTime, eventTime, trigger} = desiredAlarms[matchIndex];
                const eventTitle = ev.title || 'Event';
                const todoTitle = buildAlarmTodoTitle(alarmEmoji, eventTitle, eventTime, trigger);
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
                    pendingOps.push(async () => {
                        try {
                            const patch: AlarmUpdatePatch = {};
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
                            issues++;
                            err('alarmService', `ERROR updating alarm: ${key} - ${getErrorText(e)}`);
                        }
                    });
                }
            } else if (!truncated) {
                pendingOps.push(async () => {
                    try {
                        await deleteNote(joplin, alarm.id);
                        alarmsDeleted++;
                    } catch (e) {
                        issues++;
                        err('alarmService', `ERROR deleting invalid alarm: ${key} - ${getErrorText(e)}`);
                    }
                });
            }
        }

        for (let i = 0; i < desiredAlarms.length; i++) {
            if (matchedDesiredIndices.has(i)) continue;

            const {alarmTime, eventTime, trigger} = desiredAlarms[i];
            const eventTitle = ev.title || 'Event';
            const todoTitle = buildAlarmTodoTitle(alarmEmoji, eventTitle, eventTime, trigger);
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

            pendingOps.push(async () => {
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
                        const patch: AlarmUpdatePatch = {
                            todo_due: alarmTime,
                            todo_completed: 0,
                            is_todo: 1,
                        };
                        await updateNote(joplin, created.id, patch);
                    }
                    alarmsCreated++;
                    log('alarmService', `Created alarm: ${todoTitle} due ${new Date(alarmTime).toISOString()}`);
                } catch (e) {
                    issues++;
                    err('alarmService', `ERROR creating alarm: ${key} - ${getErrorText(e)}`);
                }
            });
        }
    }

    await runWithConcurrency(pendingOps, ALARM_OPS_CONCURRENCY);

    if (alarmsDeleted || alarmsCreated || alarmsUpdated) {
        await say(`Alarms sync summary: deleted ${alarmsDeleted}, created ${alarmsCreated}, updated ${alarmsUpdated} (next ${alarmRangeDays} days)`);
    }

    return {alarmsCreated, alarmsDeleted, alarmsUpdated, issues, warnings};
}
