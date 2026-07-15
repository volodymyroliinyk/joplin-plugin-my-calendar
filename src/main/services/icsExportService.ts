import {Occurrence} from '../utils/dateUtils';

const DEFAULT_PROD_ID = '-//MyCalendar//Joplin//EN';
const ICS_LINE_LIMIT = 75;

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function formatUtcDateTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.getUTCFullYear().toString() + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate()) +
        'T' + pad2(date.getUTCHours()) + pad2(date.getUTCMinutes()) + pad2(date.getUTCSeconds()) + 'Z';
}

function formatDateInZone(timestamp: number, timeZone?: string): string {
    if (timeZone) {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', {
                timeZone,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
            }).formatToParts(new Date(timestamp)).reduce<Record<string, string>>((result, part) => {
                if (part.type !== 'literal') result[part.type] = part.value;
                return result;
            }, {});
            if (parts.year && parts.month && parts.day) {
                return `${parts.year}${parts.month}${parts.day}`;
            }
        } catch {
            // Invalid timezones fall back to the stable UTC representation.
        }
    }

    const date = new Date(timestamp);
    return date.getUTCFullYear().toString() + pad2(date.getUTCMonth() + 1) + pad2(date.getUTCDate());
}

function escapeIcsText(value: string): string {
    return (value || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function foldIcsLine(line: string, limit: number = ICS_LINE_LIMIT): string[] {
    if (line.length <= limit) return [line];
    const folded: string[] = [];
    for (let offset = 0; offset < line.length; offset += limit) {
        const chunk = line.slice(offset, offset + limit);
        folded.push(offset === 0 ? chunk : ` ${chunk}`);
    }
    return folded;
}

export function buildCalendarIcs(events: Occurrence[], prodId: string = DEFAULT_PROD_ID): string {
    const lines: string[] = [];
    const push = (line: string): void => {
        lines.push(...foldIcsLine(line));
    };

    push('BEGIN:VCALENDAR');
    push('VERSION:2.0');
    push(`PRODID:${prodId}`);
    push('CALSCALE:GREGORIAN');

    for (const event of events) {
        const uid = event.occurrenceId || `${event.id}@mycalendar`;
        push('BEGIN:VEVENT');
        push(`UID:${escapeIcsText(uid)}`);
        push(`DTSTAMP:${formatUtcDateTime(Date.now())}`);
        if (event.allDay) {
            push(`DTSTART;VALUE=DATE:${formatDateInZone(event.startUtc, event.tz)}`);
            const exclusiveEndUtc = event.endUtc != null ? event.endUtc + 1 : event.startUtc + 24 * 60 * 60 * 1000;
            push(`DTEND;VALUE=DATE:${formatDateInZone(exclusiveEndUtc, event.tz)}`);
        } else {
            push(`DTSTART:${formatUtcDateTime(event.startUtc)}`);
            if (event.endUtc) push(`DTEND:${formatUtcDateTime(event.endUtc)}`);
        }
        push(`SUMMARY:${escapeIcsText(event.title || 'Event')}`);
        if (event.location) push(`LOCATION:${escapeIcsText(event.location)}`);
        if (event.description) push(`DESCRIPTION:${escapeIcsText(event.description)}`);
        if (event.color) push(`X-COLOR:${escapeIcsText(event.color)}`);
        push('END:VEVENT');
    }
    push('END:VCALENDAR');
    return lines.join('\r\n');
}
