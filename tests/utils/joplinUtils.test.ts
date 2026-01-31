// tests/utils/joplinUtils.test.ts
//
// src/main/utils/joplinUtils.ts
//
// npx jest tests/utils/joplinUtils.test.ts --runInBand --no-cache;
//
import {
    normalizeRecurrenceIdForKey,
    makeEventKey,
    parseUidAndRecurrence,
    extractAllAlarmKeysFromBody,
    extractAllEventKeysFromBody,
    replaceEventBlockByKey,
    extractEventColorFromBody,
} from '../../src/main/utils/joplinUtils';

describe('joplinUtils', () => {
    describe('normalizeRecurrenceIdForKey', () => {
        test('returns empty string for undefined/empty/whitespace', () => {
            expect(normalizeRecurrenceIdForKey(undefined)).toBe('');
            expect(normalizeRecurrenceIdForKey('')).toBe('');
            expect(normalizeRecurrenceIdForKey('   ')).toBe('');
        });

        test('keeps DATE:yyyyMMdd as-is (case-insensitive)', () => {
            expect(normalizeRecurrenceIdForKey('DATE:20250131')).toBe('DATE:20250131');
            expect(normalizeRecurrenceIdForKey('date:20250131')).toBe('date:20250131');
        });

        test('normalizes "TZID:yyyymmddTHHMMSS(Z?)" to the datetime part', () => {
            expect(normalizeRecurrenceIdForKey('Europe/Kyiv:20250131T010203Z')).toBe('20250131T010203Z');
            expect(normalizeRecurrenceIdForKey('TZID:20250131T010203')).toBe('20250131T010203');
        });

        test('returns original trimmed value when not matching special cases', () => {
            expect(normalizeRecurrenceIdForKey(' 20250131T010203Z ')).toBe('20250131T010203Z');
            expect(normalizeRecurrenceIdForKey('SOMETHING:ELSE:20250131T010203Z')).toBe('SOMETHING:ELSE:20250131T010203Z');
        });
    });

    describe('makeEventKey', () => {
        test('trims uid and uses normalized recurrence id', () => {
            expect(makeEventKey('  abc  ', 'Europe/Kyiv:20250131T010203Z')).toBe('abc|20250131T010203Z');
        });

        test('works with empty recurrence id', () => {
            expect(makeEventKey('abc', undefined)).toBe('abc|');
            expect(makeEventKey('abc', '   ')).toBe('abc|');
        });
    });

    describe('parseUidAndRecurrence', () => {
        test('extracts uid and recurrence_id (case-insensitive, multiline)', () => {
            const inner = [
                'something: else',
                'UID:  my-uid  ',
                'recurrence_id: Europe/Kyiv:20250131T010203Z',
            ].join('\n');

            expect(parseUidAndRecurrence(inner)).toEqual({
                uid: 'my-uid',
                recurrence_id: 'Europe/Kyiv:20250131T010203Z',
            });
        });

        test('returns uid undefined if missing; recurrence_id empty string if missing', () => {
            const inner = 'recurrence_id: 20250131T010203Z';
            expect(parseUidAndRecurrence(inner)).toEqual({
                uid: undefined,
                recurrence_id: '20250131T010203Z',
            });

            const inner2 = 'uid: x';
            expect(parseUidAndRecurrence(inner2)).toEqual({
                uid: 'x',
                recurrence_id: '',
            });
        });
    });

    describe('extractAllAlarmKeysFromBody', () => {
        test('extracts alarm keys from multiple mycalendar-alarm blocks; skips blocks without uid', () => {
            const body = [
                'text before',
                '```mycalendar-alarm',
                'uid: A',
                'recurrence_id: Europe/Kyiv:20250131T010203Z',
                '```',
                '',
                '```mycalendar-alarm',
                'recurrence_id: DATE:20250131',
                '```',
                '',
                '```mycalendar-alarm',
                'uid: B',
                'recurrence_id: DATE:20250131',
                '```',
                'text after',
            ].join('\n');

            expect(extractAllAlarmKeysFromBody(body)).toEqual([
                {key: 'A|20250131T010203Z', uid: 'A', recurrence_id: 'Europe/Kyiv:20250131T010203Z'},
                {key: 'B|DATE:20250131', uid: 'B', recurrence_id: 'DATE:20250131'},
            ]);
        });

        test('handles CRLF newlines', () => {
            const body = [
                '```mycalendar-alarm',
                'uid: A',
                'recurrence_id: 20250131T010203Z',
                '```',
            ].join('\r\n');

            expect(extractAllAlarmKeysFromBody(body)).toEqual([
                {key: 'A|20250131T010203Z', uid: 'A', recurrence_id: '20250131T010203Z'},
            ]);
        });
    });

    describe('extractAllEventKeysFromBody', () => {
        test('extracts keys from multiple mycalendar-event blocks; skips blocks without uid', () => {
            const body = [
                '```mycalendar-event',
                'uid: A',
                'recurrence_id: Europe/Kyiv:20250131T010203Z',
                '```',
                '',
                '```mycalendar-event',
                'recurrence_id: DATE:20250131',
                '```',
                '',
                '```mycalendar-event',
                'uid: B',
                '```',
            ].join('\n');

            expect(extractAllEventKeysFromBody(body)).toEqual([
                'A|20250131T010203Z',
                'B|',
            ]);
        });
    });

    describe('replaceEventBlockByKey', () => {
        const mkBlock = (uid: string, rid?: string, extraLines: string[] = []) => {
            const lines = ['```mycalendar-event', `uid: ${uid}`];
            if (rid !== undefined) lines.push(`recurrence_id: ${rid}`);
            lines.push(...extraLines);
            lines.push('```');
            return lines.join('\n');
        };

        test('replaces matching uid + normalized recurrence id', () => {
            const body = [
                'before',
                mkBlock('A', 'Europe/Kyiv:20250131T010203Z', ['color: red']),
                'after',
            ].join('\n');

            const newBlock = mkBlock('A', 'Europe/Kyiv:20250131T010203Z', ['color: blue']);
            const out = replaceEventBlockByKey(body, 'A', 'Europe/Kyiv:20250131T010203Z', newBlock);

            expect(out).toContain('color: blue');
            expect(out).not.toContain('color: red');
            expect(out).toContain('before');
            expect(out).toContain('after');
        });

        test('replaces when target has no recurrence and block has no recurrence', () => {
            const body = [mkBlock('A', undefined, ['color: red'])].join('\n');
            const newBlock = mkBlock('A', undefined, ['color: blue']);
            const out = replaceEventBlockByKey(body, 'A', undefined, newBlock);
            expect(out).toContain('color: blue');
            expect(out).not.toContain('color: red');
        });

        test('does not replace when uid does not match; appends new block', () => {
            const body = [
                'before',
                mkBlock('X', '20250131T010203Z', ['color: red']),
                'after\n\n',
            ].join('\n');

            const newBlock = mkBlock('A', '20250131T010203Z', ['color: blue']);
            const out = replaceEventBlockByKey(body, 'A', '20250131T010203Z', newBlock);

            // original remains
            expect(out).toContain('uid: X');
            expect(out).toContain('color: red');
            // appended at end with newline
            expect(out.trimEnd().endsWith(newBlock)).toBe(true);
        });

        test('only replaces the matching one among multiple blocks', () => {
            const body = [
                mkBlock('A', '20250131T010203Z', ['color: red']),
                mkBlock('A', '20250131T020304Z', ['color: green']),
            ].join('\n\n');

            const newBlock = mkBlock('A', '20250131T020304Z', ['color: blue']);
            const out = replaceEventBlockByKey(body, 'A', '20250131T020304Z', newBlock);

            expect(out).toContain('color: red');
            expect(out).toContain('color: blue');
            expect(out).not.toContain('color: green');
        });
    });

    describe('extractEventColorFromBody', () => {
        test('returns color for matching uid + recurrence', () => {
            const body = [
                '```mycalendar-event',
                'uid: A',
                'recurrence_id: Europe/Kyiv:20250131T010203Z',
                'color:  #ff00aa ',
                '```',
            ].join('\n');

            expect(extractEventColorFromBody(body, 'A', 'Europe/Kyiv:20250131T010203Z')).toBe('#ff00aa');
        });

        test('returns color for matching uid when recurrence is empty on both sides', () => {
            const body = [
                '```mycalendar-event',
                'uid: A',
                'color: red',
                '```',
            ].join('\n');

            expect(extractEventColorFromBody(body, 'A', undefined)).toBe('red');
        });

        test('returns undefined when no matching block or no color line', () => {
            const body = [
                '```mycalendar-event',
                'uid: A',
                'recurrence_id: 20250131T010203Z',
                '```',
            ].join('\n');

            expect(extractEventColorFromBody(body, 'A', '20250131T010203Z')).toBeUndefined();
            expect(extractEventColorFromBody(body, 'B', undefined)).toBeUndefined();
        });
    });
});
