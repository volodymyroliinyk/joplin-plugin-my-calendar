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

    function selectedDayUtc() {
        const selected = document.querySelector('#mc-grid .mc-cell.mc-selected') as HTMLElement | null;
        if (!selected) throw new Error('Missing selected day');
        return Number(selected.dataset.utc);
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

    test('grouped day events mode renders three subsections and distributes events by status', () => {
        loadScript();

        const dayStart = selectedDayUtc();
        const now = new Date('2025-01-01T12:00:00Z').getTime();
        expect(now).toBe(dayStart + 12 * 60 * 60 * 1000);

        sendSettings({showEventTimeline: true, dayEventsViewMode: 'grouped', dayEventsRefreshMinutes: 1});
        sendRangeEvents([
            {
                id: 'e-ongoing',
                title: 'Ongoing event',
                startUtc: now - 5 * 60 * 1000,
                endUtc: now + 5 * 60 * 1000,
            },
            {
                id: 'e-future',
                title: 'Feature event',
                startUtc: now + 10 * 60 * 1000,
                endUtc: now + 15 * 60 * 1000,
            },
            {
                id: 'e-past',
                title: 'Past event',
                startUtc: now - 20 * 60 * 1000,
                endUtc: now - 10 * 60 * 1000,
            },
        ]);

        const headings = Array.from(document.querySelectorAll('.mc-day-events-group-title')).map((el) => el.textContent);
        expect(headings).toEqual(['Ongoing', 'Feature', 'Past']);

        expect(document.querySelector('[data-group-list=\"ongoing\"]')?.textContent || '').toContain('Ongoing event');
        expect(document.querySelector('[data-group-list=\"feature\"]')?.textContent || '').toContain('Feature event');
        expect(document.querySelector('[data-group-list=\"past\"]')?.textContent || '').toContain('Past event');

        expect(document.querySelectorAll('.mc-events-timeline-now-line').length).toBe(1);
    });

    test('grouped mode updates event section over time even when event timeline is hidden', () => {
        loadScript();

        const dayStart = selectedDayUtc();
        const now = new Date('2025-01-01T12:00:00Z').getTime();
        expect(now).toBe(dayStart + 12 * 60 * 60 * 1000);

        sendSettings({showEventTimeline: false, dayEventsViewMode: 'grouped', dayEventsRefreshMinutes: 1});
        sendRangeEvents([
            {
                id: 'e-moving',
                title: 'Moving event',
                startUtc: now + 2_000,
                endUtc: now + 4_000,
            },
        ]);

        expect(document.querySelector('[data-group-list=\"feature\"]')?.textContent || '').toContain('Moving event');
        expect(document.querySelector('[data-group-list=\"ongoing\"]')?.textContent || '').not.toContain('Moving event');

        // At startUtc the refresh timer should move event to ongoing.
        jest.advanceTimersByTime(3_500);
        expect(document.querySelector('[data-group-list=\"ongoing\"]')?.textContent || '').toContain('Moving event');

        // At endUtc the refresh timer should move event to past.
        jest.advanceTimersByTime(2_500);
        expect(document.querySelector('[data-group-list=\"past\"]')?.textContent || '').toContain('Moving event');
    });

    test('grouped mode hides empty sections (example: only past events)', () => {
        loadScript();

        const dayStart = selectedDayUtc();
        const now = new Date('2025-01-01T12:00:00Z').getTime();
        expect(now).toBe(dayStart + 12 * 60 * 60 * 1000);

        sendSettings({showEventTimeline: true, dayEventsViewMode: 'grouped', dayEventsRefreshMinutes: 1});
        sendRangeEvents([
            {
                id: 'e-past-only',
                title: 'Past only',
                startUtc: now - 60 * 60 * 1000,
                endUtc: now - 30 * 60 * 1000,
            },
        ]);

        const ongoingSection = document.querySelector('[data-group=\"ongoing\"]') as HTMLElement | null;
        const featureSection = document.querySelector('[data-group=\"feature\"]') as HTMLElement | null;
        const pastSection = document.querySelector('[data-group=\"past\"]') as HTMLElement | null;

        expect(ongoingSection).toBeTruthy();
        expect(featureSection).toBeTruthy();
        expect(pastSection).toBeTruthy();

        expect(ongoingSection?.style.display).toBe('none');
        expect(featureSection?.style.display).toBe('none');
        expect(pastSection?.style.display).toBe('');
        expect(document.querySelector('[data-group-list=\"past\"]')?.textContent || '').toContain('Past only');
    });
});
