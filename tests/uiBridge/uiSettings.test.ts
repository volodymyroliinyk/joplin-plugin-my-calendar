// tests/uiBridge/uiSettings.test.ts
// src/main/uiBridge/uiSettings.ts
//
// npx jest tests/uiBridge/uiSettings.test.ts --runInBand --no-cache;
//

type SettingsMock = {
    getWeekStart: jest.Mock<any, any>;
    getDebugEnabled: jest.Mock<any, any>;
    getDayEventsRefreshMinutes: jest.Mock<any, any>;
    getIcsExportUrl?: jest.Mock<any, any>;
};

type LoggerMock = {
    setDebugEnabled: jest.Mock<any, any>;
};

const loadModuleWithMocks = async (settingsMock: SettingsMock, loggerMock: LoggerMock) => {
    jest.resetModules();

    jest.doMock('../../src/main/settings/settings', () => ({
        getWeekStart: settingsMock.getWeekStart,
        getDebugEnabled: settingsMock.getDebugEnabled,
        getDayEventsRefreshMinutes: settingsMock.getDayEventsRefreshMinutes,
        ...(settingsMock.getIcsExportUrl ? {getIcsExportUrl: settingsMock.getIcsExportUrl} : {}),
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

    test('posts uiSettings to panel and syncs debug into logger (no getIcsExportUrl => empty string)', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(5),
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
            icsExportUrl: '',
            dayEventsRefreshMinutes: 5,
        });
    });

    test('includes icsExportUrl when settings.getIcsExportUrl exists', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('sunday'),
            getDebugEnabled: jest.fn().mockResolvedValue(false),
            getIcsExportUrl: jest.fn().mockResolvedValue('https://example.test/export.ics'),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(5),
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
            icsExportUrl: 'https://example.test/export.ics',
            dayEventsRefreshMinutes: 5,
        });
    });

    test('does nothing if joplin.views.panels.postMessage is missing', async () => {
        const settingsMock: SettingsMock = {
            getWeekStart: jest.fn().mockResolvedValue('monday'),
            getDebugEnabled: jest.fn().mockResolvedValue(true),
            getDayEventsRefreshMinutes: jest.fn().mockResolvedValue(5),
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
