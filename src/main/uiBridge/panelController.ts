// src/main/uiBridge/panelController.ts

import {ensureAllEventsCache, getEventsCacheVersion, invalidateAllEventsCache} from '../services/eventsCache';
import {importIcsIntoNotes} from '../services/icsImportService';
import {showToast} from '../utils/toast';
import {pushUiSettings} from './uiSettings';
import {dbg, err, info, log, warn} from '../utils/logger';
import {getIcsImportAlarmRangeDays} from '../settings/settings';
import {Joplin} from '../types/joplin.interface';
import {getAllFolders, flattenFolderTree} from '../services/folderService';
import {getAllTagsPaged, TagItem} from '../services/joplinNoteService';
import {EventInput} from '../parsers/eventParser';
import {Occurrence} from '../utils/dateUtils';
import {getErrorText} from '../utils/errorUtils';
import {normalizeHexColor} from '../utils/colorUtils';
import {CalendarEventFormPayload, createCalendarEventNote} from '../services/eventNoteService';

function isoDate(utc: number): string {
    return new Date(utc).toISOString().slice(0, 10);
}

function isNumber(v: unknown): v is number {
    return typeof v === 'number' && Number.isFinite(v);
}

function isString(v: unknown): v is string {
    return typeof v === 'string';
}

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null;
}

const KNOWN_MSG_NAMES = [
    'uiLog',
    'uiReady',
    'requestRangeEvents',
    'dateClick',
    'openNote',
    'exportRangeIcs',
    'icsImport',
    'calendarEventCreate',
    'clearEventsCache',
    'runScheduledIcsImport',
    'requestFolders',
    'requestTags',
] as const;

type KnownMsgName = typeof KNOWN_MSG_NAMES[number];

function isKnownMsgName(v: unknown): v is KnownMsgName {
    return isString(v) && (KNOWN_MSG_NAMES as readonly string[]).includes(v);
}

type PanelMsg =
    | {
    name: 'uiLog';
    source?: string;
    level?: string;
    args?: unknown[];
}
    | { name: 'uiReady' }
    | { name: 'requestRangeEvents'; fromUtc: number; toUtc: number }
    | { name: 'dateClick'; dateUtc: number; fromUtc?: number; toUtc?: number }
    | { name: 'openNote'; id?: string }
    | { name: 'exportRangeIcs'; fromUtc: number; toUtc: number }
    | {
    name: 'icsImport';
    ics?: string;
    targetFolderId?: unknown;
    preserveLocalColor?: boolean;
    defaultColor?: unknown;
}
    | {
    name: 'calendarEventCreate';
    payload?: CalendarEventFormPayload;
}
    | { name: 'clearEventsCache' }
    | { name: 'runScheduledIcsImport' }
    | { name: 'requestFolders' }
    | { name: 'requestTags' };

type UiErrorPayload = { __error: true; message?: string; stack?: string };
type ImportResultLike = {
    added: number;
    updated: number;
    skipped: number;
    errors: number;
    alarmsCreated: number;
    alarmsDeleted: number;
    issues?: number;
    warnings?: Array<{
        code: string;
        key: string;
        message: string;
        existingNoteId?: string;
        duplicateNoteId?: string;
        keptInputIndex?: number;
        discardedInputIndex?: number;
        uid?: string;
        tzid?: string;
        inputIndex?: number;
    }>;
};

function buildImportDoneText(result: ImportResultLike): string {
    const base = `ICS import finished: added=${result.added}, updated=${result.updated}, skipped=${result.skipped}, errors=${result.errors}, alarmsCreated=${result.alarmsCreated}, alarmsDeleted=${result.alarmsDeleted}`;
    if ((result.issues ?? 0) > 0) {
        return `${base}, issues=${result.issues}`;
    }
    return base;
}

type UtcRange = {
    fromUtc: number;
    toUtc: number;
};

type RangeCacheEntry = {
    version: number;
    events: Occurrence[];
};

function buildRangeIcsFilename(fromUtc: number, toUtc: number): string {
    return `mycalendar_${isoDate(fromUtc)}_${isoDate(toUtc)}.ics`;
}

function unwrapMessage(rawMsg: unknown): unknown {
    if (isRecord(rawMsg) && 'message' in rawMsg) {
        return rawMsg.message;
    }
    return rawMsg;
}

function isUiErrorPayload(v: unknown): v is UiErrorPayload {
    return isRecord(v) && v.__error === true;
}

function restoreUiLogArg(arg: unknown): unknown {
    if (!isUiErrorPayload(arg)) return arg;
    const e = new Error(arg.message || 'UI error');
    e.stack = arg.stack;
    return e;
}

function isValidUtcRange(fromUtc: unknown, toUtc: unknown): boolean {
    return isNumber(fromUtc) && isNumber(toUtc) && fromUtc <= toUtc;
}

function getDayRange(dateUtc: number): UtcRange {
    return {
        fromUtc: dateUtc,
        toUtc: dateUtc + 24 * 60 * 60 * 1000 - 1,
    };
}

function parseImportDefaultColor(value: unknown): string | undefined {
    if (!isString(value)) return undefined;
    return normalizeHexColor(value, {allowShort: true}) || undefined;
}

function sortTagsForSelect(tags: TagItem[]): TagItem[] {
    return [...tags]
        .filter((tag) => isString(tag.id) && isString(tag.title) && tag.title.trim())
        .sort((a, b) => a.title.localeCompare(b.title, undefined, {sensitivity: 'base'}));
}

async function postImportFailure(
    post: (message: unknown) => Promise<void>,
    errorText: string,
): Promise<void> {
    await post({name: 'importError', error: errorText});
    await showToast('error', `ICS import failed: ${errorText}`, 5000);
}

async function handleIcsImportMessage(
    joplin: Joplin,
    post: (message: unknown) => Promise<void>,
    msg: Extract<PanelMsg, { name: 'icsImport' }>,
    invalidateCalendarData: () => void,
): Promise<void> {
    const sendStatus = async (text: string) => {
        await post({name: 'importStatus', text});
        await showToast('info', text, 5000);
    };

    try {
        if (!isString(msg.ics) || msg.ics.length === 0) {
            await postImportFailure(post, 'Missing ICS content');
            return;
        }

        const targetFolderId = isString(msg.targetFolderId) ? msg.targetFolderId : undefined;
        const preserveLocalColor = msg.preserveLocalColor !== false;
        const fallbackColor = parseImportDefaultColor(msg.defaultColor);
        const importAlarmRangeDays = await getIcsImportAlarmRangeDays(joplin);

        const res = await importIcsIntoNotes(
            joplin,
            msg.ics,
            sendStatus,
            targetFolderId,
            preserveLocalColor,
            fallbackColor,
            importAlarmRangeDays,
        ) as ImportResultLike;

        invalidateCalendarData();
        await post({name: 'importDone', ...res});

        for (const warning of res.warnings ?? []) {
            if (!isString(warning.message) || !warning.message.trim()) continue;
            await post({name: 'importStatus', level: 'warning', text: warning.message});
            await showToast('warning', warning.message, 8000);
        }

        const doneText = buildImportDoneText(res);
        await showToast(res.errors > 0 ? 'warning' : 'success', doneText, 5000);
    } catch (error) {
        await postImportFailure(post, getErrorText(error));
    }
}

async function handleCalendarEventCreateMessage(
    joplin: Joplin,
    post: (message: unknown) => Promise<void>,
    msg: Extract<PanelMsg, { name: 'calendarEventCreate' }>,
    invalidateCalendarData: () => void,
): Promise<void> {
    try {
        if (!isRecord(msg.payload)) {
            await post({name: 'calendarEventCreateError', error: 'Missing event form payload'});
            await showToast('error', 'Event creation failed: Missing event form payload', 5000);
            return;
        }

        const result = await createCalendarEventNote(joplin, msg.payload);

        invalidateCalendarData();
        if (result.note.id) {
            await joplin.commands.execute('openNote', result.note.id);
        }
        const warnings = result.warnings ?? [];
        await post({
            name: 'calendarEventCreateDone',
            noteId: result.note.id,
            uid: result.uid,
            title: result.title,
            ...(warnings.length ? {warnings} : {}),
        });
        await post({name: 'redrawMonth'});
        if (warnings.length) {
            const warningText = `Event note created, but ${warnings.length} tag${warnings.length === 1 ? '' : 's'} could not be attached`;
            await showToast('warning', warningText, 8000);
        } else {
            await showToast('success', `Event note created: ${result.title}`, 4000);
        }
    } catch (error) {
        const errorText = getErrorText(error);
        await post({name: 'calendarEventCreateError', error: errorText});
        await showToast('error', `Event creation failed: ${errorText}`, 5000);
    }
}

function handleUiLog(msg: Extract<PanelMsg, { name: 'uiLog' }>) {
    const source = msg.source ? `[UI:${msg.source}]` : '[UI]';
    const level = msg.level || 'log';
    const args = Array.isArray(msg.args) ? msg.args : [];

    const restored = args.map(restoreUiLogArg);

    switch (level) {
        case 'debug':
            dbg(source, ...restored);
            break;
        case 'info':
            info(source, ...restored);
            break;
        case 'warn':
            warn(source, ...restored);
            break;
        case 'error':
            err(source, ...restored);
            break;
        default:
            log(source, ...restored);
            break;
    }
}

export async function registerCalendarPanelController(
    joplin: Joplin,
    panel: string,
    helpers: {
        expandAllInRange: (events: EventInput[], fromUtc: number, toUtc: number) => Occurrence[];
        buildICS: (events: Occurrence[]) => string;
        runScheduledIcsImport?: () => Promise<void>;
    }
) {
    const post = (message: unknown) => joplin.views.panels.postMessage(panel, message);
    const rangeEventsCache = new Map<string, RangeCacheEntry>();

    const clearRangeEventsCache = () => {
        rangeEventsCache.clear();
    };

    const invalidateCalendarData = () => {
        invalidateAllEventsCache();
        clearRangeEventsCache();
    };

    const getRangeEvents = async (fromUtc: number, toUtc: number): Promise<Occurrence[]> => {
        const version = getEventsCacheVersion();
        const key = `${fromUtc}:${toUtc}`;
        const cached = rangeEventsCache.get(key);
        if (cached && cached.version === version) {
            return cached.events;
        }

        const all = await ensureAllEventsCache(joplin);
        const nextVersion = getEventsCacheVersion();
        const events = helpers.expandAllInRange(all, fromUtc, toUtc);
        rangeEventsCache.set(key, {version: nextVersion, events});
        return events;
    };

    await joplin.views.panels.onMessage(panel, async (rawMsg: unknown) => {
        try {
            const unwrapped = unwrapMessage(rawMsg);
            if (!isRecord(unwrapped) || !isKnownMsgName(unwrapped.name)) return;
            const msg = unwrapped as PanelMsg;

            switch (msg.name) {
                case 'uiLog': {
                    handleUiLog(msg);
                    return;
                }

                case 'uiReady': {
                    await pushUiSettings(joplin, panel);
                    return;
                }

                case 'requestRangeEvents': {
                    if (!isValidUtcRange(msg.fromUtc, msg.toUtc)) return;
                    const list = await getRangeEvents(msg.fromUtc, msg.toUtc);
                    await post({name: 'rangeEvents', events: list});
                    return;
                }

                case 'dateClick': {
                    if (!isNumber(msg.dateUtc)) return;

                    let dayStart: number;
                    let dayEnd: number;
                    if (isValidUtcRange(msg.fromUtc, msg.toUtc)) {
                        dayStart = msg.fromUtc!;
                        dayEnd = msg.toUtc!;
                    } else {
                        const range = getDayRange(msg.dateUtc);
                        dayStart = range.fromUtc;
                        dayEnd = range.toUtc;
                    }

                    const list = (await getRangeEvents(dayStart, dayEnd))
                        .filter((e) => {
                            if (!isNumber(e.startUtc)) return false;
                            const endUtc = isNumber(e.endUtc) ? e.endUtc : e.startUtc;
                            return endUtc >= dayStart && e.startUtc <= dayEnd;
                        });

                    await post({
                        name: 'showEvents',
                        dateUtc: msg.dateUtc,
                        events: list,
                    });
                    return;
                }

                case 'openNote': {
                    if (msg.id) {
                        await joplin.commands.execute('openNote', msg.id);
                    }
                    return;
                }

                case 'exportRangeIcs': {
                    if (!isValidUtcRange(msg.fromUtc, msg.toUtc)) return;

                    const list = await getRangeEvents(msg.fromUtc, msg.toUtc);
                    const ics = helpers.buildICS(list);

                    await post({
                        name: 'rangeIcs',
                        ics,
                        filename: buildRangeIcsFilename(msg.fromUtc, msg.toUtc),
                    });
                    return;
                }

                case 'icsImport': {
                    await handleIcsImportMessage(joplin, post, msg, invalidateCalendarData);
                    return;
                }

                case 'calendarEventCreate': {
                    await handleCalendarEventCreateMessage(joplin, post, msg, invalidateCalendarData);
                    return;
                }

                case 'clearEventsCache': {
                    invalidateCalendarData();
                    await post({name: 'redrawMonth'});
                    await showToast('info', 'Events cache cleared', 3000);
                    return;
                }

                case 'runScheduledIcsImport': {
                    try {
                        await helpers.runScheduledIcsImport?.();
                        await post({name: 'scheduledIcsImportFinished'});
                    } catch (error) {
                        const errorText = getErrorText(error);
                        await post({name: 'scheduledIcsImportFinished', error: errorText});
                        await showToast('error', `Scheduled ICS import failed: ${errorText}`, 5000);
                    }
                    return;
                }

                case 'requestFolders': {
                    const rows = await getAllFolders(joplin);
                    const folders = flattenFolderTree(rows);
                    await post({name: 'folders', folders});
                    return;
                }

                case 'requestTags': {
                    const tags = sortTagsForSelect(await getAllTagsPaged(joplin));
                    await post({name: 'tags', tags});
                    return;
                }

                default:
                    return;
            }
        } catch (e) {
            err('panelController', 'onMessage error:', e);
            const unwrapped = unwrapMessage(rawMsg);
            if (isRecord(unwrapped) && unwrapped.name === 'requestRangeEvents') {
                await post({name: 'rangeEvents', events: []});
            }
        }
    });
}
