// tests/services/noteBuilder.test.ts
//
// src/main/services/noteBuilder.ts
//
// npx jest tests/services/noteBuilder.test.ts --runInBand --no-cache;

import {
    buildMyCalBlock,
    buildAlarmBody,
    sanitizeForMarkdownBlock,
    isValidHexColor,
    isValidJoplinNoteId,
} from '../../src/main/services/noteBuilder';

describe('noteBuilder', () => {

    describe('sanitizeForMarkdownBlock', () => {
        test('removes backticks', () => {
            expect(sanitizeForMarkdownBlock('Hello ``` world')).toBe("Hello ''' world");
        });

        test('collapses newlines for single-line fields', () => {
            expect(sanitizeForMarkdownBlock('Line 1\nLine 2', true)).toBe('Line 1 Line 2');
            expect(sanitizeForMarkdownBlock('Line 1\r\nLine 2', true)).toBe('Line 1 Line 2');
        });

        test('keeps newlines if not single-line', () => {
            expect(sanitizeForMarkdownBlock('Line 1\nLine 2', false)).toBe('Line 1\nLine 2');
        });

        test('stringifies and trims non-string input', () => {
            expect(sanitizeForMarkdownBlock(123)).toBe('123');
            expect(sanitizeForMarkdownBlock('  a  ')).toBe('a');
            expect(sanitizeForMarkdownBlock(null)).toBe('');
            expect(sanitizeForMarkdownBlock(undefined)).toBe('');
        });
    });

    describe('isValidHexColor', () => {
        test('validates correctly', () => {
            expect(isValidHexColor("#fff")).toBe(true);
            expect(isValidHexColor("#AABBCC")).toBe(true);
            expect(isValidHexColor("red")).toBe(false);
            expect(isValidHexColor("#GGGGGG")).toBe(false);
            expect(isValidHexColor(undefined)).toBe(false);
        });
    });

    describe('isValidJoplinNoteId', () => {
        test('validates 32-char hex ids', () => {
            expect(isValidJoplinNoteId('0123456789abcdef0123456789ABCDEF')).toBe(true);
            expect(isValidJoplinNoteId('not-an-id')).toBe(false);
            expect(isValidJoplinNoteId(undefined)).toBe(false);
        });
    });

    describe('buildMyCalBlock', () => {
        test('generates basic block', () => {
            const ev = {
                title: "Test Event",
                start: "2025-01-15 10:00:00+00:00",
                uid: "u1"
            };
            const block = buildMyCalBlock(ev);
            expect(block).toContain("```mycalendar-event");
            expect(block).toContain("title: Test Event");
            expect(block).toContain("start: 2025-01-15 10:00:00+00:00");
            expect(block).toContain("\nuid: u1\n");
            expect(block).toContain("```");
        });

        test('includes valid color only', () => {
            const withColor = buildMyCalBlock({
                title: 'Color',
                start: '2025-01-15 10:00',
                color: '#AABBCC',
            });
            expect(withColor).toContain('color: #AABBCC');
            const badColor = buildMyCalBlock({
                title: 'BadColor',
                start: '2025-01-15 10:00',
                color: 'red',
            });
            expect(badColor).not.toContain('color:');
        });

        test('includes repeats and alarms; normalizes repeat_interval', () => {
            const ev = {
                title: "Weekly Repeat",
                start: "2025-01-15 10:00",
                repeat: "weekly" as const,
                repeat_interval: "2" as any,
                valarms: [{trigger: "-PT15M"}]
            };
            const block = buildMyCalBlock(ev);
            expect(block).toContain("repeat: weekly");
            expect(block).toContain("repeat_interval: 2");
            expect(block).toContain("valarm: {\"trigger\":\"-PT15M\"}");
        });

        test('omits repeat block when repeat is none', () => {
            const block = buildMyCalBlock({
                title: 'None',
                start: '2025-01-15 10:00',
                repeat: 'none' as const,
            });
            expect(block).not.toContain('\nrepeat:');
            expect(block).not.toContain('repeat_interval:');
        });

        test('allows multiline description but prevents fence breakout', () => {
            const block = buildMyCalBlock({
                title: 'Desc',
                start: '2025-01-15 10:00',
                description: 'Line 1\n```\nLine 2',
            });
            expect(block).toContain("description: Line 1\n'''\nLine 2");
            expect(block.trimEnd().endsWith('```')).toBe(true);
        });

        test('includes recurrence_id only when uid is present', () => {
            const withUid = buildMyCalBlock({
                title: 'Rec',
                start: '2025-01-15 10:00',
                uid: 'u1',
                recurrence_id: '2025-01-15T10:00:00Z',
            });
            expect(withUid).toContain('uid: u1');
            expect(withUid).toContain('recurrence_id: 2025-01-15T10:00:00Z');

            const withoutUid = buildMyCalBlock({
                title: 'Rec2',
                start: '2025-01-15 10:00',
                recurrence_id: '2025-01-15T10:00:00Z',
            });
            expect(withoutUid).not.toContain('recurrence_id:');
        });
    });

    describe('buildAlarmBody', () => {
        test('generates alarm body with sanitized fields', () => {
            const body = buildAlarmBody(
                'My ``` Event',
                '2025-01-15 10:00\nUTC',
                '0123456789abcdef0123456789abcdef',
                'Todo ``` title',
                'uid```',
                'rid```',
                '2025-01-15 09:45\nUTC',
                'Trigger ``` desc\nX'
            );

            expect(body).toContain("[My ''' Event at 2025-01-15 10:00 UTC](:/0123456789abcdef0123456789abcdef)");
            expect(body).toContain('```mycalendar-alarm');
            expect(body).toContain("title: Todo ''' title");
            expect(body).toContain("trigger_desc: Trigger ''' desc X");
            expect(body).toContain('when: 2025-01-15 09:45 UTC');
            expect(body).toContain("uid: uid'''");
            expect(body).toContain("recurrence_id: rid'''");
            expect(body.trimEnd().endsWith('```')).toBe(true);
        });

        test('falls back to sanitizing invalid note id', () => {
            const body = buildAlarmBody(
                'Event',
                'Time',
                'bad```id',
                'Todo',
                'uid',
                'rid',
                'when',
                'desc'
            );
            expect(body).toContain("](:/bad'''id)");
        });
    });
});
