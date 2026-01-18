// tests/uiBridge/uiSettings.test.ts
// src/main/uiBridge/uiSettings.ts
//
// npx jest tests/uiBridge/uiSettings.test.ts --runInBand --no-cache;
//

type SettingsMock = {
    getWeekStart: jest.Mock<any, any>;
    getDebugEnabled: jest.Mock<any, any>;
    getDayEventsRefreshMinutes: jest.Mock<any, any>;
    getIcsExportLinks?: jest.Mock<any, any>;
};

type LoggerMock = {
    setDebugEnabled: jest.Mock<any, any>;
};

const getDayEventsRefreshMinutes_DEFAULT: number = 1;

const loadModuleWithMocks = async (settingsMock: SettingsMock, loggerMock: LoggerMock) => {
    jest.resetModules();

    jest.doMock('../../src/main/settings/settings', () => ({
        getWeekStart: settingsMock.getWeekStart,
        getDebugEnabled: settingsMock.getDebugEnabled,
        getDayEventsRefreshMinutes: settingsMock.getDayEventsRefreshMinutes,
        ...(settingsMock.getIcsExportLinks ? {getIcsExportLinks: settingsMock.getIcsExportLinks} : {}),
    }));

    jest.doMock('../../src/main/utils/logger', () => ({
        setDebugEnabled: loggerMock.setDebugEnabled,
    }));

    // import after doMock
    return await import('../../src/main/uiBridge/uiSettings');
};

describe('uiSettings.pushUiSettings', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('posts uiSettings to panel and syncs debug into logger (no getIcsExportLinks => array fo empty strings)', async () => {
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
        expect(settingsMock.getDebugEnabled).toHaveBeenCalledTimes(1);

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
    });

    test('does nothing if joplin.views.panels.postMessage is missing', async () => {
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
});
