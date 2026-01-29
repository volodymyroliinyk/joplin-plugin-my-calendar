// tests/views/calendarView.test.ts
// src/main/views/calendarView.ts
//
// npx jest tests/views/calendarView.test.ts --runInBand --no-cache;
//
import {createCalendarPanel} from '../../src/main/views/calendarView';

type MockedPanels = {
    create: jest.Mock;
    setHtml: jest.Mock;
    addScript: jest.Mock;
    show: jest.Mock;
};

function makeJoplinMock() {
    const panels: MockedPanels = {
        create: jest.fn(),
        setHtml: jest.fn(),
        addScript: jest.fn(),
        show: jest.fn(),
    };

    const joplin = {
        views: {
            panels,
        },
    };

    return {joplin: joplin as any, panels};
}

describe('calendarView.createCalendarPanel', () => {
    let logSpy: jest.SpyInstance;

    beforeEach(() => {
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        jest.clearAllMocks();
    });

    test('happy path: creates panel, sets html, adds scripts, shows panel, returns panel', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockResolvedValue(undefined);
        panels.addScript.mockResolvedValue(undefined);
        panels.show.mockResolvedValue(undefined);

        const panel = await createCalendarPanel(joplin);

        expect(panel).toBe('panel-123');

        // create called with fixed id
        expect(panels.create).toHaveBeenCalledWith('mycalendarPanel');

        // setHtml called with string containing key container ids
        expect(panels.setHtml).toHaveBeenCalledTimes(1);
        const [, html] = panels.setHtml.mock.calls[0];
        expect(html).toContain('id="cal-root"');
        expect(html).toContain('id="mc-toolbar"');
        expect(html).toContain('id="mc-grid"');
        expect(html).toContain('id="mc-events"');
        expect(html).toContain('id="mc-log"');

        // scripts added in order
        expect(panels.addScript).toHaveBeenCalledTimes(3);
        expect(panels.addScript).toHaveBeenNthCalledWith(1, 'panel-123', './ui/calendar.css');
        expect(panels.addScript).toHaveBeenNthCalledWith(2, 'panel-123', './ui/calendar.js');
        expect(panels.addScript).toHaveBeenNthCalledWith(3, 'panel-123', './ui/icsImport.js');

        // show called once
        expect(panels.show).toHaveBeenCalledWith('panel-123');

        // log emitted
        // Updated expectation: [MyCalendar][calendarView created]
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar][calendarView created]');

        // optional: strict call order across methods
        expect(panels.create.mock.invocationCallOrder[0]).toBeLessThan(panels.setHtml.mock.invocationCallOrder[0]);
        expect(panels.setHtml.mock.invocationCallOrder[0]).toBeLessThan(panels.addScript.mock.invocationCallOrder[0]);
        expect(panels.addScript.mock.invocationCallOrder[2]).toBeLessThan(panels.show.mock.invocationCallOrder[0]);
    });

    test('fails if panels.create rejects; no other calls', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockRejectedValue(new Error('create failed'));

        await expect(createCalendarPanel(joplin)).rejects.toThrow('create failed');

        expect(panels.setHtml).not.toHaveBeenCalled();
        expect(panels.addScript).not.toHaveBeenCalled();
        expect(panels.show).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('fails if panels.setHtml rejects; scripts/show not called', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockRejectedValue(new Error('setHtml failed'));

        await expect(createCalendarPanel(joplin)).rejects.toThrow('setHtml failed');

        expect(panels.addScript).not.toHaveBeenCalled();
        expect(panels.show).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('fails if addScript(calendar.css) rejects; later scripts/show not called', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockResolvedValue(undefined);

        panels.addScript.mockRejectedValueOnce(new Error('add css failed'));

        await expect(createCalendarPanel(joplin)).rejects.toThrow('add css failed');

        expect(panels.addScript).toHaveBeenCalledTimes(1);
        expect(panels.addScript).toHaveBeenCalledWith('panel-123', './ui/calendar.css');
        expect(panels.show).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('fails if addScript(calendar.js) rejects; third script/show not called', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockResolvedValue(undefined);

        panels.addScript
            .mockResolvedValueOnce(undefined) // css ok
            .mockRejectedValueOnce(new Error('add js failed')); // js fails

        await expect(createCalendarPanel(joplin)).rejects.toThrow('add js failed');

        expect(panels.addScript).toHaveBeenCalledTimes(2);
        expect(panels.addScript).toHaveBeenNthCalledWith(1, 'panel-123', './ui/calendar.css');
        expect(panels.addScript).toHaveBeenNthCalledWith(2, 'panel-123', './ui/calendar.js');
        expect(panels.show).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('fails if addScript(icsImport.js) rejects; show not called', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockResolvedValue(undefined);

        panels.addScript
            .mockResolvedValueOnce(undefined) // css ok
            .mockResolvedValueOnce(undefined) // js ok
            .mockRejectedValueOnce(new Error('add icsImport failed')); // icsImport fails

        await expect(createCalendarPanel(joplin)).rejects.toThrow('add icsImport failed');

        expect(panels.addScript).toHaveBeenCalledTimes(3);
        expect(panels.show).not.toHaveBeenCalled();
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('fails if panels.show rejects; log not called', async () => {
        const {joplin, panels} = makeJoplinMock();

        panels.create.mockResolvedValue('panel-123');
        panels.setHtml.mockResolvedValue(undefined);
        panels.addScript.mockResolvedValue(undefined);
        panels.show.mockRejectedValue(new Error('show failed'));

        await expect(createCalendarPanel(joplin)).rejects.toThrow('show failed');

        expect(logSpy).not.toHaveBeenCalled();
    });
});
