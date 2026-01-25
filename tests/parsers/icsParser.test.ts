// tests/parsers/icsParser.test.ts

import {
    parseIcs,
    parseRRule,
    parseImportText,
    parseLineValue,
    unfoldIcsLines,
    unescapeIcsText
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

    test('parseLineValue splits key, params and value', () => {
        const line = "DTSTART;TZID=America/Toronto:20250115T100000";
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
