// tests/uiBridge/uiSettings.test.ts
//
// src/main/uiBridge/uiSettings.ts
//
// npx jest tests/uiBridge/uiSettings.test.ts --runInBand --no-cache;
//

type SettingsMock = {
    getWeekStart: jest.Mock<any, any>;
    getDebugEnabled: jest.Mock<any, any>;
    getDayEventsRefreshMinutes: jest.Mock<any, any>;
    // can be function or any other value to test compat branch
    getIcsExportLinks?: any;
};

type LoggerMock = {
    setDebugEnabled: jest.Mock<any, any>;
};

const getDayEventsRefreshMinutes_DEFAULT: number = 1;

const loadModuleWithMocks = async (
    settingsMock: SettingsMock,
    loggerMock: LoggerMock,
) => {
    jest.resetModules();

    const settingsExports: any = {
        getWeekStart: settingsMock.getWeekStart,
        getDebugEnabled: settingsMock.getDebugEnabled,
        getDayEventsRefreshMinutes: settingsMock.getDayEventsRefreshMinutes,
        ...(settingsMock.getIcsExportLinks ? {getIcsExportLinks: settingsMock.getIcsExportLinks} : {}),
    };
    // Important: include getIcsExportLinks even if it is NOT a function
    if (Object.prototype.hasOwnProperty.call(settingsMock, 'getIcsExportLinks')) {
        settingsExports.getIcsExportLinks = settingsMock.getIcsExportLinks;
    }

    jest.doMock('../../src/main/settings/settings', () => settingsExports);

    jest.doMock('../../src/main/utils/logger', () => ({
        setDebugEnabled: loggerMock.setDebugEnabled,
    }));

    // import after doMock
    return await import('../../src/main/uiBridge/uiSettings');
};

describe('uiSettings.buildUiSettingsMessage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('returns message payload and syncs debug into logger', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const joplin = {any: 'shape'};

        const msg = await mod.buildUiSettingsMessage(joplin);

        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(true);
        expect(msg).toEqual({
            name: 'uiSettings',
            weekStart: 'monday',
            debug: true,
            icsExportLinks: [],
            dayEventsRefreshMinutes: getDayEventsRefreshMinutes_DEFAULT,
        });
    });

    test('propagates settings errors (getWeekStart) and does not change logger', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockRejectedValue(new Error('weekStart failed')),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        await expect(mod.buildUiSettingsMessage({})).rejects.toThrow('weekStart failed');
        expect(loggerMock.setDebugEnabled).not.toHaveBeenCalled();
    });
});

describe('uiSettings.pushUiSettings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('posts uiSettings to panel and syncs debug into logger (no getIcsExportLinks => [])', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const postMessage = jest.fn().mockResolvedValue(undefined);
        const joplin = {views: {panels: {postMessage}}};

        await mod.pushUiSettings(joplin, 'panel-1');

        expect(settingsMock.getWeekStart).toHaveBeenCalledTimes(1);
        expect(settingsMock.getWeekStart).toHaveBeenCalledWith(joplin);
        expect(settingsMock.getDebugEnabled).toHaveBeenCalledTimes(1);
        expect(settingsMock.getDebugEnabled).toHaveBeenCalledWith(joplin);
        expect(settingsMock.getDayEventsRefreshMinutes).toHaveBeenCalledTimes(1);
        expect(settingsMock.getDayEventsRefreshMinutes).toHaveBeenCalledWith(joplin);


        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(true);

        expect(postMessage).toHaveBeenCalledTimes(1);
        expect(postMessage).toHaveBeenCalledWith('panel-1', {
            name: 'uiSettings',
            weekStart: 'monday',
            debug: true,
            icsExportLinks: [],
            dayEventsRefreshMinutes: getDayEventsRefreshMinutes_DEFAULT,
        });
    });

    test('includes icsExportLinks when settings provides them', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('sunday'),
            getDebugEnabled: jest.fn().mockResolvedValue(false),
            getIcsExportLinks: jest
                .fn()
                .mockResolvedValue([{title: 'Work', url: 'https://example.test/work.ics'}]),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const postMessage = jest.fn().mockResolvedValue(undefined);
        const joplin = {views: {panels: {postMessage}}};

        await mod.pushUiSettings(joplin, 'panel-2');

        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(false);

        expect(postMessage).toHaveBeenCalledWith('panel-2', {
            name: 'uiSettings',
            weekStart: 'sunday',
            debug: false,
            icsExportLinks: [{title: 'Work', url: 'https://example.test/work.ics'}],
            dayEventsRefreshMinutes: getDayEventsRefreshMinutes_DEFAULT,
        });

        expect(settingsMock.getIcsExportLinks).toHaveBeenCalledTimes(1);
        expect(settingsMock.getIcsExportLinks).toHaveBeenCalledWith(joplin);

    });

    test('getIcsExportLinksCompat returns [] when getIcsExportLinks exists but is not a function', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getIcsExportLinks: 123, // non-function
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const postMessage = jest.fn().mockResolvedValue(undefined);
        const joplin = {views: {panels: {postMessage}}};

        await mod.pushUiSettings(joplin, 'panel-non-fn');

        expect(postMessage).toHaveBeenCalledWith('panel-non-fn', expect.objectContaining({icsExportLinks: []}));
    });

    test('casts debugEnabled to boolean (truthy/falsy)', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(0), // falsy
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const postMessage = jest.fn().mockResolvedValue(undefined);
        const joplin = {views: {panels: {postMessage}}};

        await mod.pushUiSettings(joplin, 'panel-falsy');

        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(false);
        expect(postMessage).toHaveBeenCalledWith(
            'panel-falsy',
            expect.objectContaining({debug: false}),
        );
    });

    test('does nothing if joplin.views.panels.postMessage is missing (but still syncs logger)', async () => {

        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const joplin = {views: {panels: {}}};

        await expect(mod.pushUiSettings(joplin, 'panel-3')).resolves.toBeUndefined();

        // still syncs logger even if panel cannot receive message
        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(true);
    });

    test('does nothing if postMessage exists but is not a function (but still syncs logger)', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const joplin: any = {views: {panels: {postMessage: 'nope'}}};

        await expect(mod.pushUiSettings(joplin, 'panel-not-fn')).resolves.toBeUndefined();
        expect(loggerMock.setDebugEnabled).toHaveBeenCalledWith(true);
    });

    test('propagates postMessage errors', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const err = new Error('postMessage failed');
        const postMessage = jest.fn().mockRejectedValue(err);
        const joplin = {views: {panels: {postMessage}}};

        await expect(mod.pushUiSettings(joplin, 'panel-err')).rejects.toThrow('postMessage failed');
    });

    test('propagates getIcsExportLinks errors and does not post message', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getIcsExportLinks: jest.fn().mockRejectedValue(new Error('ics links failed')),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(getDayEventsRefreshMinutes_DEFAULT),
        };
        const loggerMock: LoggerMock = {
            setDebugEnabled: jest.fn(),
        };

        const mod = await loadModuleWithMocks(settingsMock, loggerMock);

        const postMessage = jest.fn().mockResolvedValue(undefined);
        const joplin = {views: {panels: {postMessage}}};

        await expect(mod.pushUiSettings(joplin, 'panel-ics-err')).rejects.toThrow('ics links failed');
        expect(postMessage).not.toHaveBeenCalled();
    });
});
