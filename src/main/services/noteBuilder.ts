// src/main/services/noteBuilder.ts

import {IcsEvent, IcsValarm} from '../types/icsTypes';

const MAX_TITLE_LEN = 500;
const MAX_LOCATION_LEN = 1000;
const MAX_DESCRIPTION_LEN = 10000;

/**
 * Ensures a value recorded in a ```mycalendar-event``` or ```mycalendar-alarm``` block
 * cannot "break out" of the fence.
 * - Removes backticks
 * - Replaces newlines with spaces for single-line fields
 */
export function sanitizeForMarkdownBlock(input: unknown, singleLine = true): string {
    let s = String(input ?? '').trim();
    // Prevent breaking out of code block (```)
    s = s.replace(/`/g, "'");

    if (singleLine) {
        // Enforce single line to prevent key: value injection
        s = s.replace(/[\r\n]+/g, ' ');
    }
    return s;
}

export function isValidHexColor(c?: string): boolean {
    if (!c) return false;
    return /^#(?:[0-9a-fA-F]{3}){1,2}$/.test(c);
}

export function isValidJoplinNoteId(id?: string): boolean {
    if (!id) return false;
    return /^[0-9a-fA-F]{32}$/.test(id);
}

function normalizePositiveInt(value: unknown, defaultValue: number): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return defaultValue;
    return Math.max(1, Math.floor(n));
}

function pushKV(
    lines: string[],
    key: string,
    value: unknown,
    opts: { singleLine?: boolean; maxLen?: number } = {}
): void {
    if (value === undefined || value === null || value === '') return;

    const singleLine = opts.singleLine ?? true;
    const maxLen = opts.maxLen;

    let s = sanitizeForMarkdownBlock(value, singleLine);
    if (typeof maxLen === 'number') s = s.slice(0, maxLen);

    lines.push(`${key}: ${s}`);
}

function valarmToJsonLine(a: IcsValarm): string {
    // Stable key order for tests + diffs
    const o: Record<string, unknown> = {trigger: a.trigger};
    if (a.related) o.related = a.related;
    if (a.action) o.action = a.action;
    if (a.description) o.description = a.description;
    if (a.summary) o.summary = a.summary;
    if (typeof a.repeat === 'number') o.repeat = a.repeat;
    if (a.duration) o.duration = a.duration;
    return JSON.stringify(o);
}

/**
 * Form the block ```mycalendar-event ... ```
 */
export function buildMyCalBlock(ev: IcsEvent): string {
    const lines: string[] = [];
    lines.push('```mycalendar-event');

    pushKV(lines, 'title', ev.title, {maxLen: MAX_TITLE_LEN});
    pushKV(lines, 'start', ev.start);
    pushKV(lines, 'end', ev.end);
    pushKV(lines, 'tz', ev.tz);

    if (isValidHexColor(ev.color)) {
        lines.push(`color: ${ev.color}`);
    }

    pushKV(lines, 'location', ev.location, {maxLen: MAX_LOCATION_LEN});

    if (ev.description) {
        // Description can be multiline in ICS.
        // We sanitize to prevent breaking ``` but keep newlines.
        pushKV(lines, 'description', ev.description, {singleLine: false, maxLen: MAX_DESCRIPTION_LEN});
    }

    if (ev.valarms && ev.valarms.length) {
        lines.push('');
        for (const a of ev.valarms) {
            // valarm is JSON.
            const json = valarmToJsonLine(a);
            pushKV(lines, 'valarm', json);
        }
    }

    const repeat = ev.repeat && ev.repeat !== 'none' ? ev.repeat : undefined;
    if (repeat) {
        lines.push('');
        // repeat is an enum in our model, but sanitize anyway to be safe.
        pushKV(lines, 'repeat', repeat);
        lines.push(`repeat_interval: ${normalizePositiveInt(ev.repeat_interval, 1)}`);
        pushKV(lines, 'repeat_until', ev.repeat_until);
        pushKV(lines, 'byweekday', ev.byweekday);
        pushKV(lines, 'bymonthday', ev.bymonthday);
    }

    if (ev.all_day) lines.push(`all_day: true`);

    if (ev.uid) {
        lines.push('');
        pushKV(lines, 'uid', ev.uid);
        if (ev.recurrence_id) {
            pushKV(lines, 'recurrence_id', ev.recurrence_id);
        }
    }

    lines.push('```');
    return lines.join('\n');
}

export function buildAlarmBody(
    eventTitle: string,
    eventTimeStr: string,
    eventNoteId: string,
    todoTitle: string,
    uid: string,
    rid: string,
    alarm_at: string,
    triggerDesc: string
): string {
    const safeEventTitle = sanitizeForMarkdownBlock(eventTitle);
    // const safeEventTimeStr = sanitizeForMarkdownBlock(eventTimeStr);
    const safeNoteId = isValidJoplinNoteId(eventNoteId) ? eventNoteId : sanitizeForMarkdownBlock(eventNoteId);
    const safeAlarmAt = sanitizeForMarkdownBlock(alarm_at);
    const safeTriggerDesc = sanitizeForMarkdownBlock(triggerDesc);

    return [
        '',
        '',
        '',
        `[${safeEventTitle}](:/${safeNoteId})`,
        '',
        '',
        '',
        '```mycalendar-alarm',
        `trigger_desc: ${safeTriggerDesc}`,
        `alarm_at: ${safeAlarmAt}`,
        `uid: ${sanitizeForMarkdownBlock(uid)}`,
        `recurrence_id: ${sanitizeForMarkdownBlock(rid)}`,
        '```',
        '',
    ].join('\n');
}
