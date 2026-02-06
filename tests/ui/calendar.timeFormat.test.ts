/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const calendarJs = fs.readFileSync(path.resolve(__dirname, '../../src/ui/calendar.js'), 'utf8');

describe('calendar.js time format', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mc-log"></div>
            <div id="mc-toolbar"></div>
            <div id="mc-grid"></div>
            <div id="mc-events-day-label"></div>
            <ul id="mc-events-list"></ul>
        `;

        (window as any).webviewApi = {
            postMessage: jest.fn(),
            onMessage: jest.fn(),
        };

        jest.useFakeTimers();
        // Set "today" to match the event date so selectedDayUtc matches
        jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        document.body.innerHTML = '';
        (window as any).__mcUiSettings = undefined;
        (window as any).__mcHasUiSettings = false;
        (window as any).__mcMsgHandlers = undefined;
        (window as any).__mcMsgDispatcherInstalled = false;
    });

    function loadScript() {
        eval(calendarJs);
    }

    function sendSettings(settings: any) {
        const handler = (window as any).__mcMsgHandlers[0];
        handler({
            name: 'uiSettings',
            ...settings
        });
    }

    function sendRangeEvents(events: any[]) {
        const handler = (window as any).__mcMsgHandlers[0];
        handler({
            name: 'rangeEvents',
            events
        });
    }

    test('formats time as 24h by default (or when set to 24h)', () => {
        loadScript();
        sendSettings({timeFormat: '24h'});

        const start = new Date('2025-01-01T13:05:00Z').getTime(); // 13:05 UTC

        const events = [{
            id: 'e1',
            title: 'Event 1',
            startUtc: start,
            endUtc: start + 3600000
        }];

        sendRangeEvents(events);

        const timeEl = document.querySelector('.mc-time');
        expect(timeEl).not.toBeNull();
        // 13:05–14:05
        expect(timeEl!.textContent).toMatch(/13:05.*14:05/);
        expect(timeEl!.textContent).not.toMatch(/PM/);
    });

    test('formats time as 12h when set to 12h', () => {
        loadScript();
        sendSettings({timeFormat: '12h'});

        const start = new Date('2025-01-01T13:05:00Z').getTime(); // 1:05 PM UTC

        const events = [{
            id: 'e1',
            title: 'Event 1',
            startUtc: start,
            endUtc: start + 3600000
        }];

        sendRangeEvents(events);

        const timeEl = document.querySelector('.mc-time');
        expect(timeEl).not.toBeNull();

        // In UTC: 1:05 PM
        // Note: exact format depends on locale (en-US usually).
        // JSDOM might use en-US by default.

        // We check for "1:05" or "01:05" and "PM" (or "pm")
        expect(timeEl!.textContent).toMatch(/1:05.*PM/i);
    });
});
