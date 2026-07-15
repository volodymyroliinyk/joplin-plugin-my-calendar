import {IcsEvent} from '../types/icsTypes';
import {Joplin} from '../types/joplin.interface';
import {normalizeHexColor} from '../utils/colorUtils';
import {parseDateTimeToUTC, parseRepeatUntilToUTC} from '../parsers/eventParser';
import {buildMyCalBlock, sanitizeForMarkdownBlock} from './noteBuilder';
import {attachTagToNote, createNote, NoteItem} from './joplinNoteService';
import {getErrorText} from '../utils/errorUtils';
import {
    canonicalWeekdays,
    normalizeAllDayDateRange,
    normalizeMonthDay,
    normalizeRepeatFrequency,
    normalizeRepeatInterval,
    normalizeTimeZone,
    parseCalendarBoolean,
    REPEAT_FREQUENCIES,
} from './calendarEventNormalizer';

const MAX_TITLE_LEN = 500;
const MAX_LOCATION_LEN = 1000;
const MAX_DESCRIPTION_LEN = 10000;
const MAX_EXDATES = 100;
const MAX_TAG_IDS = 100;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export type CalendarEventValidationField =
    | 'targetFolderId'
    | 'title'
    | 'location'
    | 'description'
    | 'color'
    | 'allDay'
    | 'startDate'
    | 'endDate'
    | 'timeZone'
    | 'repeatInterval'
    | 'repeat'
    | 'repeatUntil'
    | 'weekdays'
    | 'monthDay'
    | 'excludeDates'
    | 'tags';

export class CalendarEventValidationError extends Error {
    constructor(
        public readonly code: string,
        public readonly field: CalendarEventValidationField,
        message: string,
    ) {
        super(message);
        this.name = 'CalendarEventValidationError';
    }
}

function invalid(code: string, field: CalendarEventValidationField, message: string): never {
    throw new CalendarEventValidationError(code, field, message);
}
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
    warnings: TagAttachmentWarning[];
};

export type TagAttachmentWarning = {
    code: 'tag_attachment_failed';
    tagId: string;
    message: string;
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

function parseByMonthDay(value: unknown): string | undefined {
    const raw = asTrimmedString(value);
    if (!raw) return undefined;
    const monthDay = normalizeMonthDay(raw);
    if (monthDay == null) {
        invalid('invalid_month_day', 'monthDay', 'Monthly repeat day must be between 1 and 31');
    }
    return String(monthDay);
}

function parseByWeekday(value: unknown): string | undefined {
    const raw = asTrimmedString(value);
    if (!raw) return undefined;

    return canonicalWeekdays(raw, true);
}

function parseExdates(value: unknown, startText: string, startUtc: number, tz?: string): string[] | undefined {
    const raw = Array.isArray(value)
        ? value.map((v) => asTrimmedString(v))
        : asTrimmedString(value).split(/\r?\n|,/);

    const unique = Array.from(new Set(raw.map((v) => v.trim()).filter(Boolean)));
    if (unique.length > MAX_EXDATES) {
        invalid('too_many_exdates', 'excludeDates', `Use no more than ${MAX_EXDATES} exclude dates`);
    }
    for (const exdate of unique) {
        const exdateUtc = parseDateTimeToUTC(exdate, tz);
        if (exdateUtc == null) invalid('invalid_exdate', 'excludeDates', `Invalid exclude date: ${exdate}`);
        const isSameLocalDate = /^\d{4}-\d{2}-\d{2}$/.test(exdate) && startText.slice(0, 10) === exdate;
        if (exdateUtc < startUtc && !isSameLocalDate) {
            invalid('exdate_before_start', 'excludeDates', 'Exclude dates must not be before the event start');
        }
    }
    return unique.length ? unique : undefined;
}

function parseTagIds(value: unknown): string[] {
    const raw = Array.isArray(value)
        ? value.map((v) => asTrimmedString(v))
        : asTrimmedString(value).split(',');

    const unique = Array.from(new Set(raw.map((v) => v.trim()).filter(Boolean)));
    if (unique.length > MAX_TAG_IDS) invalid('too_many_tags', 'tags', `Select no more than ${MAX_TAG_IDS} tags`);
    for (const tagId of unique) {
        if (!isSafeId(tagId)) invalid('invalid_tag_id', 'tags', 'Selected tags contain an invalid tag id');
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
        invalid('invalid_notebook', 'targetFolderId', 'Select a valid target notebook');
    }

    const title = asTrimmedString(payload.title);
    if (!title) invalid('title_required', 'title', 'Title is required');
    if (title.length > MAX_TITLE_LEN) invalid('title_too_long', 'title', `Title must not exceed ${MAX_TITLE_LEN} characters`);

    const start = asTrimmedString(payload.start);
    if (!start) invalid('start_required', 'startDate', 'Start date/time is required');

    const rawTz = asTrimmedString(payload.tz);
    const tz = rawTz ? normalizeTimeZone(rawTz) : undefined;
    if (rawTz && !tz) invalid('invalid_timezone', 'timeZone', 'Timezone must be a valid IANA timezone');

    const parsedAllDay = parseCalendarBoolean(payload.all_day);
    if (payload.all_day != null && parsedAllDay === undefined) {
        invalid('invalid_all_day', 'allDay', 'All-day value is invalid');
    }
    const allDay = parsedAllDay === true;
    const normalizedAllDayRange = allDay ? normalizeAllDayDateRange(start, asTrimmedString(payload.end)) : undefined;
    const normalizedStart = normalizedAllDayRange?.start ?? start;
    const normalizedEnd = normalizedAllDayRange?.end ?? asTrimmedString(payload.end);

    const startUtc = parseDateTimeToUTC(normalizedStart, tz);
    if (startUtc == null) invalid('invalid_start', 'startDate', 'Start date/time is invalid');

    if (normalizedEnd) {
        const endUtc = parseDateTimeToUTC(normalizedEnd, tz);
        if (endUtc == null) invalid('invalid_end', 'endDate', 'End date/time is invalid');
        if (endUtc < startUtc) invalid('end_before_start', 'endDate', 'End date/time must not be before start');
    }

    const rawRepeat = asTrimmedString(payload.repeat).toLowerCase();
    if (rawRepeat && !(REPEAT_FREQUENCIES as readonly string[]).includes(rawRepeat)) {
        invalid('invalid_repeat', 'repeat', 'Select a valid recurrence frequency');
    }
    const repeat = normalizeRepeatFrequency(payload.repeat);
    const repeatIntervalRaw = asTrimmedString(payload.repeat_interval);
    if (repeat !== 'none' && repeatIntervalRaw) {
        const repeatInterval = Number(repeatIntervalRaw);
        if (!Number.isInteger(repeatInterval) || repeatInterval < 1 || repeatInterval > 999) {
            invalid('invalid_repeat_interval', 'repeatInterval', 'Repeat interval must be a whole number from 1 to 999');
        }
    }
    const repeatUntil = asTrimmedString(payload.repeat_until);
    if (repeatUntil) {
        const repeatUntilUtc = parseRepeatUntilToUTC(repeatUntil, tz);
        if (repeatUntilUtc == null) invalid('invalid_repeat_until', 'repeatUntil', 'Repeat-until date/time is invalid');
        if (repeatUntilUtc < startUtc) {
            invalid('repeat_until_before_start', 'repeatUntil', 'Repeat-until date must not be before start');
        }
    }

    const rawColor = asTrimmedString(payload.color);
    const color = normalizeHexColor(rawColor, {allowShort: true}) || undefined;
    if (rawColor && !color) invalid('invalid_color', 'color', 'Color must be a valid hex value');
    let byweekday: string | undefined;
    if (repeat === 'weekly') {
        try {
            byweekday = parseByWeekday(payload.byweekday);
        } catch (error) {
            invalid('invalid_weekdays', 'weekdays', getErrorText(error));
        }
        if (!byweekday) invalid('weekdays_required', 'weekdays', 'Select at least one weekday for weekly recurrence');
    }
    const bymonthday = repeat === 'monthly' ? parseByMonthDay(payload.bymonthday) : undefined;
    if (repeat === 'monthly' && !bymonthday) {
        invalid('month_day_required', 'monthDay', 'Enter a day of month for monthly recurrence');
    }
    const exdates = repeat !== 'none' ? parseExdates(payload.exdates, normalizedStart, startUtc, tz) : undefined;
    const tagIds = parseTagIds(payload.tagIds);
    const location = asTrimmedString(payload.location);
    if (location.length > MAX_LOCATION_LEN) {
        invalid('location_too_long', 'location', `Location must not exceed ${MAX_LOCATION_LEN} characters`);
    }
    const description = asTrimmedString(payload.description);
    if (description.length > MAX_DESCRIPTION_LEN) {
        invalid('description_too_long', 'description', `Description must not exceed ${MAX_DESCRIPTION_LEN} characters`);
    }

    const event: IcsEvent = {
        uid: generateMyCalendarEventUid(),
        title,
        start: normalizedStart,
        end: normalizedEnd || undefined,
        tz,
        all_day: allDay || undefined,
        color,
        location: limitString(location, MAX_LOCATION_LEN) || undefined,
        description: limitString(description, MAX_DESCRIPTION_LEN) || undefined,
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

    const warnings: TagAttachmentWarning[] = [];
    if (note.id && normalized.tagIds.length) {
        for (const tagId of normalized.tagIds) {
            try {
                await attachTagToNote(joplin, tagId, note.id);
            } catch (error) {
                warnings.push({
                    code: 'tag_attachment_failed',
                    tagId,
                    message: `Event note was created, but tag ${tagId} could not be attached: ${getErrorText(error)}`,
                });
            }
        }
    }

    return {
        note,
        uid: normalized.event.uid!,
        title: normalized.noteTitle,
        warnings,
    };
}
