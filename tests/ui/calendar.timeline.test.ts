/**
 * @jest-environment jsdom
 */

import * as fs from 'fs';
import * as path from 'path';

const calendarJs = fs.readFileSync(path.resolve(__dirname, '../../src/ui/calendar.js'), 'utf8');

describe('calendar.js timeline settings', () => {
    // let windowSpy: jest.SpyInstance;

    beforeEach(() => {
        document.body.innerHTML = `
            <div id="mc-log"></div>
            <div id="mc-toolbar"></div>
            <div id="mc-grid"></div>
            <div id="mc-events-day-label"></div>
            <ul id="mc-events-list"></ul>
        `;

        // Mock webviewApi
        (window as any).webviewApi = {
            postMessage: jest.fn(),
            onMessage: jest.fn(),
        };

        jest.useFakeTimers();
        jest.setSystemTime(new Date('2025-01-01T12:00:00Z'));
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.useRealTimers();
        document.body.innerHTML = '';
        // Reset global state
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

    function futureEvent() {
        return [{
            id: 'e1',
            title: 'Event 1',
            // future relative to mocked now (12:00Z)
            startUtc: new Date('2025-01-01T12:30:00Z').getTime(),
            endUtc: new Date('2025-01-01T13:00:00Z').getTime(),
        }];
    }

    test('timeline and shared line are rendered when showEventTimeline=true and schedules timers', () => {
        loadScript();

        sendSettings({showEventTimeline: true, dayEventsRefreshMinutes: 1});
        sendRangeEvents(futureEvent());

        const timeline = document.querySelector('.mc-event-timeline');
        expect(timeline).not.toBeNull();

        const sharedLine = document.querySelector('.mc-events-timeline-now-line');
        expect(sharedLine).not.toBeNull();

        const oldDot = document.querySelector('.mc-event-timeline-now');
        expect(oldDot).toBeNull();

        // now-line + past-status refresh timers
        expect(jest.getTimerCount()).toBe(2);
    });

    test('timeline and shared line are NOT rendered when showEventTimeline=false and does not schedule timers', () => {
        loadScript();

        sendSettings({showEventTimeline: false});

        const events = [{
            id: 'e1',
            title: 'Event 1',
            startUtc: new Date('2025-01-01T10:00:00Z').getTime(),
            endUtc: new Date('2025-01-01T11:00:00Z').getTime()
        }];

        sendRangeEvents(events);
        sendSettings({showEventTimeline: false, dayEventsRefreshMinutes: 1});
        sendRangeEvents(futureEvent());

        const timeline = document.querySelector('.mc-event-timeline');
        expect(timeline).toBeNull();

        const sharedLine = document.querySelector('.mc-events-timeline-now-line');
        expect(sharedLine).toBeNull();

        expect(jest.getTimerCount()).toBe(0);
    });

    test('toggling showEventTimeline from true to false hides existing timelines/line and stops timers', () => {
        loadScript();

        sendSettings({showEventTimeline: true, dayEventsRefreshMinutes: 1});
        sendRangeEvents(futureEvent());

        expect(document.querySelector('.mc-event-timeline')).not.toBeNull();
        expect(document.querySelector('.mc-events-timeline-now-line')).not.toBeNull();
        expect(jest.getTimerCount()).toBe(2);

        // Toggle without re-sending events (no re-render)
        sendSettings({showEventTimeline: false, dayEventsRefreshMinutes: 1});

        expect(document.querySelector('.mc-event-timeline')).toBeNull();
        expect(document.querySelector('.mc-events-timeline-now-line')).toBeNull();
        expect(jest.getTimerCount()).toBe(0);
    });
});
