// src/main/services/noteBuilder.ts

import {IcsEvent, IcsValarm} from '../types/icsTypes';

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

function valarmToJsonLine(a: IcsValarm): string {
    const o: any = {};
    // stable order for tests + diffs
    o.trigger = a.trigger;
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

    if (ev.title) lines.push(`title: ${sanitizeForMarkdownBlock(ev.title).slice(0, 500)}`);
    if (ev.start) lines.push(`start: ${sanitizeForMarkdownBlock(ev.start)}`);
    if (ev.end) lines.push(`end: ${sanitizeForMarkdownBlock(ev.end)}`);
    if (ev.tz) lines.push(`tz: ${sanitizeForMarkdownBlock(ev.tz)}`);

    if (isValidHexColor(ev.color)) {
        lines.push(`color: ${ev.color}`);
    }

    if (ev.location) lines.push(`location: ${sanitizeForMarkdownBlock(ev.location).slice(0, 1000)}`);
    if (ev.description) {
        // Description can be multiline in ICS, but our block values usually are not.
        // We sanitize to prevent breaking ``` but allow some length.
        lines.push(`description: ${sanitizeForMarkdownBlock(ev.description, false).slice(0, 10000)}`);
    }

    if (ev.valarms && ev.valarms.length) {
        lines.push('');
        for (const a of ev.valarms) {
            // valarm is JSON.
            const json = valarmToJsonLine(a);
            lines.push(`valarm: ${sanitizeForMarkdownBlock(json)}`);
        }
    }

    const repeat = ev.repeat && ev.repeat !== 'none' ? ev.repeat : undefined;
    if (repeat) {
        lines.push('');
        lines.push(`repeat: ${repeat}`);
        lines.push(`repeat_interval: ${ev.repeat_interval ?? 1}`);
        if (ev.repeat_until) lines.push(`repeat_until: ${sanitizeForMarkdownBlock(ev.repeat_until)}`);
        if (ev.byweekday) lines.push(`byweekday: ${sanitizeForMarkdownBlock(ev.byweekday)}`);
        if (ev.bymonthday) lines.push(`bymonthday: ${sanitizeForMarkdownBlock(ev.bymonthday)}`);
    }

    if (ev.all_day) lines.push(`all_day: true`);

    if (ev.uid) {
        lines.push('');
        lines.push(`uid: ${sanitizeForMarkdownBlock(ev.uid)}`);
        if (ev.recurrence_id) {
            lines.push(`recurrence_id: ${sanitizeForMarkdownBlock(ev.recurrence_id)}`);
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
    when: string,
    triggerDesc: string
): string {
    return [
        `[${eventTitle} at ${eventTimeStr}](:/${eventNoteId})`,
        '',
        '```mycalendar-alarm',
        `title: ${sanitizeForMarkdownBlock(todoTitle).slice(0, 500)}`,
        `trigger_desc: ${triggerDesc}`,
        `when: ${when}`,
        `uid: ${sanitizeForMarkdownBlock(uid)}`,
        `recurrence_id: ${sanitizeForMarkdownBlock(rid)}`,
        '```',
        '',
    ].join('\n');
}
