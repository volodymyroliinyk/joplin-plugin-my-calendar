// tests/services/noteBuilder.test.ts

import {
    buildMyCalBlock,
    sanitizeForMarkdownBlock,
    isValidHexColor
} from '../../src/main/services/noteBuilder';

describe('noteBuilder', () => {

    describe('sanitizeForMarkdownBlock', () => {
        test('removes backticks', () => {
            expect(sanitizeForMarkdownBlock("Hello ``` world")).toBe("Hello ''' world");
        });

        test('collapses newlines for single-line fields', () => {
            expect(sanitizeForMarkdownBlock("Line 1\nLine 2", true)).toBe("Line 1 Line 2");
        });

        test('keeps newlines if not single-line', () => {
            expect(sanitizeForMarkdownBlock("Line 1\nLine 2", false)).toBe("Line 1\nLine 2");
        });
    });

    describe('isValidHexColor', () => {
        test('validates correctly', () => {
            expect(isValidHexColor("#fff")).toBe(true);
            expect(isValidHexColor("#AABBCC")).toBe(true);
            expect(isValidHexColor("red")).toBe(false);
            expect(isValidHexColor("#GGGGGG")).toBe(false);
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
            expect(block).toContain("uid: u1");
            expect(block).toContain("```");
        });

        test('includes repeats and alarms', () => {
            const ev = {
                title: "Weekly Repeat",
                start: "2025-01-15 10:00",
                repeat: "weekly" as const,
                repeat_interval: 2,
                valarms: [{trigger: "-PT15M"}]
            };
            const block = buildMyCalBlock(ev);
            expect(block).toContain("repeat: weekly");
            expect(block).toContain("repeat_interval: 2");
            expect(block).toContain("valarm: {\"trigger\":\"-PT15M\"}");
        });
    });
});
