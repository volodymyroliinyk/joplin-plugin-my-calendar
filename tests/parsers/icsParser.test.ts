// tests/parsers/icsParser.test.ts
//
// src/main/parsers/icsParser.ts
//
// TZ=UTC npx jest tests/parsers/icsParser.test.ts --runInBand --detectOpenHandles --no-cache --verbose --forceExit;

jest.mock('../../src/main/utils/dateTimeUtils', () => ({
    // Minimal stub for parser tests
    icsDateToMyCalText: (v: string) => {
        const s = (v || '').trim();
        // For tests, a deterministic transformation of only the Z-format is sufficient
        // 20250115T100000Z -> 2025-01-15 10:00:00+00:00
        const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
        if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}+00:00`;
        // DATE 20250115 -> 2025-01-15 00:00:00 (prefix is enough for the all-day test)
        const d = s.match(/^(\d{4})(\d{2})(\d{2})$/);
        if (d) return `${d[1]}-${d[2]}-${d[3]} 00:00:00`;
        return s;
    },
}));

import {
    parseIcs,
    parseRRule,
    parseImportText,
    parseLineValue,
    unfoldIcsLines,
    unescapeIcsText,
    parseMyCalKeyValueText
} from '../../src/main/parsers/icsParser';

describe('icsParser', () => {

    test('unfoldIcsLines handles folded lines', () => {
        const ics = "SUMMARY:This is a very long \n line that is folded\nDESCRIPTION:Another line";
        const lines = unfoldIcsLines(ics);
        expect(lines).toContain("SUMMARY:This is a very long line that is folded");
        expect(lines).toContain("DESCRIPTION:Another line");
    });

    test('unescapeIcsText handles special characters', () => {
        expect(unescapeIcsText("Line 1\\nLine 2")).toBe("Line 1\nLine 2");
        expect(unescapeIcsText("Comma\\, Semi\\; Backslash\\\\")).toBe("Comma, Semi; Backslash\\");
    });

    test('unescapeIcsText keeps literal \\n when escaped as \\\\n', () => {
        // "\\\\n" in ICS text means a literal "\n", not a newline
        expect(unescapeIcsText("Literal\\\\n")).toBe("Literal\\n");
    });

    test('parseLineValue splits key, params and value', () => {
        const line = "DTSTART;TZID=America/Toronto:20250115T100000";
        const res = parseLineValue(line);
        expect(res).toEqual({
            key: "DTSTART",
            params: {"TZID": "America/Toronto"},
            value: "20250115T100000"
        });
    });

    test('parseLineValue strips quotes from param values', () => {
        const line = 'DTSTART;TZID="America/Toronto":20250115T100000';
        const res = parseLineValue(line);
        expect(res).toEqual({
            key: "DTSTART",
            params: {"TZID": "America/Toronto"},
            value: "20250115T100000"
        });
    });

    describe('parseRRule', () => {
        test('parses weekly rule', () => {
            const rule = "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20251231T235959Z";
            const res = parseRRule(rule);
            expect(res.repeat).toBe('weekly');
            expect(res.repeat_interval).toBe(2);
            expect(res.byweekday).toBe('MO,WE');
            expect(res.repeat_until).toBe('2025-12-31 23:59:59+00:00');
        });

        test('parses daily rule', () => {
            const rule = "FREQ=DAILY;INTERVAL=3";
            const res = parseRRule(rule);
            expect(res.repeat).toBe('daily');
            expect(res.repeat_interval).toBe(3);
        });
    });

    describe('parseIcs', () => {
        test('parses basic VEVENT with VALARM', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u1
SUMMARY:Meeting
DTSTART:20250115T100000Z
DTEND:20250115T110000Z
BEGIN:VALARM
TRIGGER:-PT15M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.uid).toBe('u1');
            expect(ev.title).toBe('Meeting');
            expect(ev.start).toBe('2025-01-15 10:00:00+00:00');
            expect(ev.valarms).toHaveLength(1);
            expect(ev.valarms![0].trigger).toBe('-PT15M');
            expect(ev.valarms![0].description).toBe('Reminder');
        });

        test('sets all_day for VALUE=DATE DTSTART/DTEND', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u2
SUMMARY:All Day
DTSTART;VALUE=DATE:20250115
DTEND;VALUE=DATE:20250116
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.uid).toBe('u2');
            expect(ev.all_day).toBe(true);
            expect(ev.start).toMatch(/^2025-01-15/);
        });

        test('captures TZID into event.tz', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u3
SUMMARY:TZ Event
DTSTART;TZID=America/Toronto:20250115T100000
DTEND;TZID=America/Toronto:20250115T110000
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.uid).toBe('u3');
            expect(ev.tz).toBe('America/Toronto');
        });

        test('parses RECURRENCE-ID with VALUE=DATE', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u4
SUMMARY:Exception
RECURRENCE-ID;VALUE=DATE:20250115
DTSTART;VALUE=DATE:20250115
DTEND;VALUE=DATE:20250116
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.recurrence_id).toBe('DATE:20250115');
        });

        test('parses RECURRENCE-ID with TZID', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u5
SUMMARY:Exception TZ
RECURRENCE-ID;TZID=America/Toronto:20250115T100000
DTSTART;TZID=America/Toronto:20250115T100000
DTEND;TZID=America/Toronto:20250115T110000
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.recurrence_id).toBe('America/Toronto:20250115T100000');
            expect(ev.tz).toBe('America/Toronto');
        });

        test('parses VALARM TRIGGER;RELATED=START', () => {
            const ics = `
BEGIN:VCALENDAR
BEGIN:VEVENT
UID:u6
SUMMARY:Alarm Related
DTSTART:20250115T100000Z
BEGIN:VALARM
TRIGGER;RELATED=START:-PT10M
ACTION:DISPLAY
DESCRIPTION:Reminder
END:VALARM
END:VEVENT
END:VCALENDAR
            `;
            const [ev] = parseIcs(ics);
            expect(ev.valarms).toHaveLength(1);
            expect(ev.valarms![0].related).toBe('START');
        });
    });

    describe('parseMyCalKeyValueText', () => {
        test('parses single event and flushes on blank line', () => {
            const text = `
title: My Event
start: 2025-01-15 10:00
           `;
            const events = parseMyCalKeyValueText(text);
            expect(events).toHaveLength(1);
            expect(events[0].title).toBe('My Event');
            expect(events[0].start).toBe('2025-01-15 10:00');
        });

        test('supports valarm as JSON and ignores invalid JSON', () => {
            const text = `
title: With Alarm
start: 2025-01-15 10:00
valarm: {"trigger":"-PT15M","action":"DISPLAY"}
valarm: not-json
            `;
            const events = parseMyCalKeyValueText(text);
            expect(events).toHaveLength(1);
            expect(events[0].valarms).toHaveLength(1);
            expect(events[0].valarms![0].trigger).toBe('-PT15M');
        });
    });

    describe('parseImportText', () => {
        test('detects ICS format', () => {
            const text = "BEGIN:VCALENDAR\nSUMMARY:Test\nEND:VCALENDAR";
            const events = parseImportText(text);
            expect(events).toHaveLength(0); // VCALENDAR alone has no events, but it used the ICS parser
        });

        test('detects Key-Value format', () => {
            const text = "title: My Event\nstart: 2025-01-15 10:00";
            const events = parseImportText(text);
            expect(events).toHaveLength(1);
            expect(events[0].title).toBe('My Event');
        });
    });
});
