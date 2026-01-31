// tests/services/occurrenceService.test.ts
//
// src/main/services/occurrenceService.ts
//
// npx jest tests/services/occurrenceService.test.ts --runInBand --no-cache;
//
import {expandOccurrences} from '../../src/main/services/occurrenceService';
import {IcsEvent} from '../../src/main/types/icsTypes';

function isoLocal(d: Date): string {
    // for debugging/readability in asserts
    return d.toISOString();
}

describe('occurrenceService.expandOccurrences', () => {
    test('non-recurring event: returns single occurrence if in window', () => {
        const ev: IcsEvent = {
            start: '2025-01-10 10:00:00+00:00',
            end: '2025-01-10 11:00:00+00:00',
            repeat: 'none',
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-02-01T00:00:00Z'));
        expect(occs).toHaveLength(1);
        expect(isoLocal(occs[0].start)).toBe('2025-01-10T10:00:00.000Z');
        expect(isoLocal(occs[0].end)).toBe('2025-01-10T11:00:00.000Z');
    });

    test('daily recurrence with interval=2', () => {
        const ev: IcsEvent = {
            start: '2025-01-01 10:00:00+00:00',
            end: '2025-01-01 10:30:00+00:00',
            repeat: 'daily',
            repeat_interval: 2,
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-07T00:00:00Z'));
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2025-01-01T10:00:00.000Z',
            '2025-01-03T10:00:00.000Z',
            '2025-01-05T10:00:00.000Z',
        ]);
    });

    test('repeat_until clamps generation', () => {
        const ev: IcsEvent = {
            start: '2025-01-01 10:00:00+00:00',
            end: '2025-01-01 10:30:00+00:00',
            repeat: 'daily',
            repeat_until: '2025-01-03 10:00:00+00:00',
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-10T00:00:00Z'));
        // inclusive by start <= hardEnd (as in your while)
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2025-01-01T10:00:00.000Z',
            '2025-01-02T10:00:00.000Z',
            '2025-01-03T10:00:00.000Z',
        ]);
    });

    test('weekly recurrence defaults to DTSTART weekday when byweekday is missing', () => {
        // 2025-01-01 is Wednesday
        const ev: IcsEvent = {
            start: '2025-01-01 10:00:00+00:00',
            end: '2025-01-01 11:00:00+00:00',
            repeat: 'weekly',
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-20T00:00:00Z'));
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2025-01-01T10:00:00.000Z',
            '2025-01-08T10:00:00.000Z',
            '2025-01-15T10:00:00.000Z',
        ]);
    });

    test('weekly recurrence with byweekday produces sorted and unique occurrences', () => {
        const ev: IcsEvent = {
            start: '2025-01-01 10:00:00+00:00', // Wed
            end: '2025-01-01 11:00:00+00:00',
            repeat: 'weekly',
            byweekday: 'MO,WE',
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-01-15T23:59:59Z'));
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2025-01-01T10:00:00.000Z', // WE
            '2025-01-06T10:00:00.000Z', // MO
            '2025-01-08T10:00:00.000Z', // WE
            '2025-01-13T10:00:00.000Z', // MO
            '2025-01-15T10:00:00.000Z', // WE
        ]);
    });

    test('monthly recurrence skips months where day-of-month does not exist (31st)', () => {
        const ev: IcsEvent = {
            start: '2025-01-31 10:00:00+00:00',
            end: '2025-01-31 11:00:00+00:00',
            repeat: 'monthly',
        };
        const occs = expandOccurrences(ev, new Date('2025-01-01T00:00:00Z'), new Date('2025-04-30T23:59:59Z'));
        // Feb (31) does not exist -> skip, Apr (31) does not exist -> skip
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2025-01-31T10:00:00.000Z',
            '2025-03-31T10:00:00.000Z',
        ]);
    });

    test('yearly recurrence skips invalid Feb 29 in non-leap years', () => {
        const ev: IcsEvent = {
            start: '2024-02-29 10:00:00+00:00',
            end: '2024-02-29 11:00:00+00:00',
            repeat: 'yearly',
        };
        const occs = expandOccurrences(ev, new Date('2024-01-01T00:00:00Z'), new Date('2028-12-31T23:59:59Z'));
        expect(occs.map(o => isoLocal(o.start))).toEqual([
            '2024-02-29T10:00:00.000Z',
            '2028-02-29T10:00:00.000Z',
        ]);
    });
});