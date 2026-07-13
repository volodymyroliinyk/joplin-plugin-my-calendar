import {IcsEvent} from '../types/icsTypes';
import {Joplin} from '../types/joplin.interface';
import {normalizeHexColor} from '../utils/colorUtils';
import {parseDateTimeToUTC, parseRepeatUntilToUTC} from '../parsers/eventParser';
import {buildMyCalBlock, sanitizeForMarkdownBlock} from './noteBuilder';
import {attachTagToNote, createNote, NoteItem} from './joplinNoteService';
import {
    canonicalWeekdays,
    normalizeAllDayDateRange,
    normalizeMonthDay,
    normalizeRepeatFrequency,
    normalizeRepeatInterval,
    normalizeTimeZone,
    parseCalendarBoolean,
} from './calendarEventNormalizer';

const MAX_TITLE_LEN = 500;
const MAX_LOCATION_LEN = 1000;
const MAX_DESCRIPTION_LEN = 10000;
const MAX_EXDATES = 100;
const MAX_TAG_IDS = 100;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export type CalendarEventFormPayload = {
    targetFolderId?: unknown;
    title?: unknown;
    start?: unknown;
    end?: unknown;
    tz?: unknown;
    all_day?: unknown;
    color?: unknown;
    location?: unknown;
    description?: unknown;
    repeat?: unknown;
    repeat_interval?: unknown;
    repeat_until?: unknown;
    byweekday?: unknown;
    bymonthday?: unknown;
    exdates?: unknown;
    tagIds?: unknown;
};

export type CreatedCalendarEventNote = {
    note: NoteItem;
    uid: string;
    title: string;
};

function asTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function limitString(value: string, maxLen: number): string {
    return value.slice(0, maxLen);
}

function isSafeId(value: string): boolean {
    return SAFE_ID_RE.test(value);
}

function parseBool(value: unknown): boolean {
    return parseCalendarBoolean(value) === true;
}

function parseByMonthDay(value: unknown): string | undefined {
    const raw = asTrimmedString(value);
    if (!raw) return undefined;
    const monthDay = normalizeMonthDay(raw);
    if (monthDay == null) {
        throw new Error('Monthly repeat day must be between 1 and 31');
    }
    return String(monthDay);
}

function parseByWeekday(value: unknown): string | undefined {
    const raw = asTrimmedString(value);
    if (!raw) return undefined;

    return canonicalWeekdays(raw, true);
}

function parseExdates(value: unknown): string[] | undefined {
    const raw = Array.isArray(value)
        ? value.map((v) => asTrimmedString(v))
        : asTrimmedString(value).split(/\r?\n|,/);

    const unique = Array.from(new Set(raw.map((v) => v.trim()).filter(Boolean))).slice(0, MAX_EXDATES);
    return unique.length ? unique : undefined;
}

function parseTagIds(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value.map((v) => asTrimmedString(v))
        : asTrimmedString(value).split(',');

    const unique = Array.from(new Set(raw.map((v) => v.trim()).filter(Boolean))).slice(0, MAX_TAG_IDS);
    for (const tagId of unique) {
        if (!isSafeId(tagId)) throw new Error('Selected tags contain an invalid tag id');
    }
    return unique;
}

function getRandomHex(size: number): string {
    const g = globalThis as unknown as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } };
    const bytes = new Uint8Array(size);
    if (g.crypto?.getRandomValues) {
        g.crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function generateMyCalendarEventUid(): string {
    return `${getRandomHex(16)}@mycalendarevent`;
}

export function normalizeCalendarEventFormPayload(payload: CalendarEventFormPayload): {
    folderId: string;
    event: IcsEvent;
    noteTitle: string;
    tagIds: string[];
} {
    const folderId = asTrimmedString(payload.targetFolderId);
    if (!folderId || !isSafeId(folderId)) {
        throw new Error('Select a valid target notebook');
    }

    const title = limitString(asTrimmedString(payload.title), MAX_TITLE_LEN);
    if (!title) throw new Error('Title is required');

    const start = asTrimmedString(payload.start);
    if (!start) throw new Error('Start date/time is required');

    const rawTz = asTrimmedString(payload.tz);
    const tz = rawTz ? normalizeTimeZone(rawTz) : undefined;
    if (rawTz && !tz) throw new Error('Timezone must be a valid IANA timezone');

    const allDay = parseBool(payload.all_day);
    const normalizedAllDayRange = allDay ? normalizeAllDayDateRange(start, asTrimmedString(payload.end)) : undefined;
    const normalizedStart = normalizedAllDayRange?.start ?? start;
    const normalizedEnd = normalizedAllDayRange?.end ?? asTrimmedString(payload.end);

    const startUtc = parseDateTimeToUTC(normalizedStart, tz);
    if (startUtc == null) throw new Error('Start date/time is invalid');

    if (normalizedEnd) {
        const endUtc = parseDateTimeToUTC(normalizedEnd, tz);
        if (endUtc == null) throw new Error('End date/time is invalid');
        if (endUtc < startUtc) throw new Error('End date/time must be after start');
    }

    const repeat = normalizeRepeatFrequency(payload.repeat);
    const repeatUntil = asTrimmedString(payload.repeat_until);
    if (repeatUntil && parseRepeatUntilToUTC(repeatUntil, tz) == null) {
        throw new Error('Repeat-until date/time is invalid');
    }

    const color = normalizeHexColor(asTrimmedString(payload.color), {allowShort: true}) || undefined;
    const byweekday = repeat === 'weekly' ? parseByWeekday(payload.byweekday) : undefined;
    const bymonthday = repeat === 'monthly' ? parseByMonthDay(payload.bymonthday) : undefined;
    const exdates = repeat !== 'none' ? parseExdates(payload.exdates) : undefined;
    const tagIds = parseTagIds(payload.tagIds);

    const event: IcsEvent = {
        uid: generateMyCalendarEventUid(),
        title,
        start: normalizedStart,
        end: normalizedEnd || undefined,
        tz,
        all_day: allDay || undefined,
        color,
        location: limitString(asTrimmedString(payload.location), MAX_LOCATION_LEN) || undefined,
        description: limitString(asTrimmedString(payload.description), MAX_DESCRIPTION_LEN) || undefined,
        repeat,
        repeat_interval: repeat !== 'none' ? normalizeRepeatInterval(payload.repeat_interval, 999) : undefined,
        repeat_until: repeat !== 'none' && repeatUntil ? repeatUntil : undefined,
        byweekday,
        bymonthday,
        exdates,
    };

    return {
        folderId,
        event,
        noteTitle: sanitizeForMarkdownBlock(title),
        tagIds,
    };
}

export async function createCalendarEventNote(
    joplin: Joplin,
    payload: CalendarEventFormPayload,
): Promise<CreatedCalendarEventNote> {
    const normalized = normalizeCalendarEventFormPayload(payload);
    const note = await createNote(joplin, {
        parent_id: normalized.folderId,
        title: normalized.noteTitle,
        body: buildMyCalBlock(normalized.event),
    });

    if (note.id && normalized.tagIds.length) {
        for (const tagId of normalized.tagIds) {
            await attachTagToNote(joplin, tagId, note.id);
        }
    }

    return {
        note,
        uid: normalized.event.uid!,
        title: normalized.noteTitle,
    };
}
