import fs from 'fs';
import path from 'path';
import {parseEventsFromBody} from '../src/main/parsers/eventParser';

describe('calendar event note examples', () => {
    const examplesDir = path.join(__dirname, '..', 'examples');
    const markdownFiles = fs.readdirSync(examplesDir)
        .filter(fileName => fileName.endsWith('.md'))
        .sort();

    const parsedExamples = markdownFiles.map(fileName => ({
        fileName,
        events: parseEventsFromBody(
            `example-${fileName}`,
            path.basename(fileName, '.md'),
            fs.readFileSync(path.join(examplesDir, fileName), 'utf8')
        ),
    }));

    test.each(parsedExamples)('$fileName contains at least one valid event', ({events}) => {
        expect(events.length).toBeGreaterThan(0);
    });

    test('collectively covers every supported recurrence frequency', () => {
        const frequencies = new Set(parsedExamples.flatMap(({events}) => events.map(event => event.repeat)));
        expect(frequencies).toEqual(new Set(['none', 'daily', 'weekly', 'monthly', 'yearly']));
    });

    test('collectively covers current optional event metadata', () => {
        const events = parsedExamples.flatMap(({events}) => events);

        expect(events.some(event => event.endUtc !== undefined)).toBe(true);
        expect(events.some(event => event.tz !== undefined)).toBe(true);
        expect(events.some(event => event.allDay === true)).toBe(true);
        expect(events.some(event => event.repeatUntilUtc !== undefined)).toBe(true);
        expect(events.some(event => event.byWeekdays?.length)).toBe(true);
        expect(events.some(event => event.byMonthDay !== undefined)).toBe(true);
        expect(events.some(event => event.exdates?.length)).toBe(true);
        expect(events.some(event => event.description?.includes('\n'))).toBe(true);
        expect(events.some(event => event.location !== undefined)).toBe(true);
        expect(events.some(event => event.color !== undefined)).toBe(true);
        expect(events.some(event => event.uid !== undefined)).toBe(true);
        expect(events.some(event => event.recurrenceId !== undefined)).toBe(true);
        expect(events.some(event => event.valarms?.length === 2 && event.hasAlarms)).toBe(true);
    });
});
