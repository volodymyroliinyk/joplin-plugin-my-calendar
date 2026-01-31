// tests/settings/settings.test.ts
//
// src/main/settings/settings.ts
//
// npx jest tests/settings/settings.test.ts --runInBand --no-cache;
//
jest.mock('../../src/main/utils/logger', () => ({
    setDebugEnabled: jest.fn(),
}));

import {setDebugEnabled} from '../../src/main/utils/logger';
import * as settings from '../../src/main/settings/settings';


describe('settings.ts logic', () => {
    describe('sanitizeExternalUrl', () => {
        test('passes through valid https URLs', () => {
            expect(settings.sanitizeExternalUrl('https://google.com')).toBe('https://google.com/');
        });

        test('passes through valid http URLs', () => {
            expect(settings.sanitizeExternalUrl('http://example.com/foo')).toBe('http://example.com/foo');
        });

        test('strips javascript: URLs', () => {
            expect(settings.sanitizeExternalUrl('javascript:alert(1)')).toBe('');
        });

        test('strips file: URLs', () => {
            expect(settings.sanitizeExternalUrl('file:///etc/passwd')).toBe('');
        });

        test('returns empty string for invalid URL', () => {
            expect(settings.sanitizeExternalUrl('not-a-url')).toBe('');
        });

        test('returns empty string for null/undefined', () => {
            expect(settings.sanitizeExternalUrl(null)).toBe('');
            expect(settings.sanitizeExternalUrl(undefined)).toBe('');
        });
    });

    describe('sanitizeTitle', () => {
        test('passes through short strings', () => {
            expect(settings.sanitizeTitle('My Link')).toBe('My Link');
        });

        test('truncates strings longer than 60 chars', () => {
            const long = 'a'.repeat(100);
            expect(settings.sanitizeTitle(long).length).toBe(60);
            expect(settings.sanitizeTitle(long)).toBe('a'.repeat(60));
        });

        test('returns empty string for null/undefined', () => {
            expect(settings.sanitizeTitle(null)).toBe('');
            expect(settings.sanitizeTitle(undefined)).toBe('');
        });
    });

    describe('getIcsImportAlarmRangeDays logic', () => {
        // We'll mock the joplin object passed to it
        const mkJoplin = (val: any) => ({
            settings: {
                value: jest.fn().mockResolvedValue(val),
            }
        });

        test('returns value if within range', async () => {
            const val = await settings.getIcsImportAlarmRangeDays(mkJoplin(45));
            expect(val).toBe(45);
        });

        test('returns default 30 if value is null/undefined/NaN', async () => {
            expect(await settings.getIcsImportAlarmRangeDays(mkJoplin(null))).toBe(30);
            expect(await settings.getIcsImportAlarmRangeDays(mkJoplin('abc'))).toBe(30);
        });

        test('clamps to min 1', async () => {
            expect(await settings.getIcsImportAlarmRangeDays(mkJoplin(-10))).toBe(1);
            expect(await settings.getIcsImportAlarmRangeDays(mkJoplin(0))).toBe(1);
        });

        test('clamps to max 365', async () => {
            expect(await settings.getIcsImportAlarmRangeDays(mkJoplin(1000))).toBe(365);
        });
    });

    describe('getDayEventsRefreshMinutes logic', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)}
        });

        test('returns value if within range 1-60', async () => {
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin(15))).toBe(15);
        });

        test('rounds fractional values', async () => {
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin(1.6))).toBe(2);
        });

        test('clamps to 1-60', async () => {
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin(0))).toBe(1);
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin(100))).toBe(60);
        });

        test('returns 1 for invalid values', async () => {
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin('abc'))).toBe(1);
            expect(await settings.getDayEventsRefreshMinutes(mkJoplin(null))).toBe(1);
        });
    });

    describe('getIcsExportLinks filtering and sanitization', () => {
        test('filters out invalid URLs and sanitizes titles', async () => {
            const mockJoplin = {
                settings: {
                    value: jest.fn().mockImplementation((key) => {
                        if (key.includes('Link1Title')) return ' Good Link ';
                        if (key.includes('Link1Url')) return 'https://ok.com';
                        if (key.includes('Link2Title')) return 'Bad';
                        if (key.includes('Link2Url')) return 'javascript:alert(1)';
                        if (key.includes('Link3Title')) return 'x'.repeat(100);
                        if (key.includes('Link3Url')) return 'http://ok2.com';
                        return '';
                    }),
                },
            };

            const links = await settings.getIcsExportLinks(mockJoplin);
            expect(links).toHaveLength(2);
            expect(links[0]).toEqual({title: 'Good Link', url: 'https://ok.com/'});
            expect(links[1].title).toHaveLength(60);
            expect(links[1].url).toBe('http://ok2.com/');
        });
    });


    describe('getWeekStart', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)},
        });

        test('returns monday by default for invalid values', async () => {
            await expect(settings.getWeekStart(mkJoplin(''))).resolves.toBe('monday');
            await expect(settings.getWeekStart(mkJoplin('tuesday'))).resolves.toBe('monday');
            await expect(settings.getWeekStart(mkJoplin(null))).resolves.toBe('monday');
        });

        test('returns sunday for valid value', async () => {
            await expect(settings.getWeekStart(mkJoplin('sunday'))).resolves.toBe('sunday');
        });
    });

    describe('getDebugEnabled', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)},
        });

        test('coerces to boolean', async () => {
            await expect(settings.getDebugEnabled(mkJoplin(true))).resolves.toBe(true);
            await expect(settings.getDebugEnabled(mkJoplin(false))).resolves.toBe(false);
            await expect(settings.getDebugEnabled(mkJoplin(1))).resolves.toBe(true);
            await expect(settings.getDebugEnabled(mkJoplin(0))).resolves.toBe(false);
        });
    });

    describe('getIcsImportEmptyTrashAfter', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)},
        });

        test('coerces to boolean', async () => {
            await expect(settings.getIcsImportEmptyTrashAfter(mkJoplin(true))).resolves.toBe(true);
            await expect(settings.getIcsImportEmptyTrashAfter(mkJoplin(false))).resolves.toBe(false);
        });
    });

    describe('registerSettings onChange sanitization + debug toggle', () => {
        test('sanitizes touched URL/title and updates logger when debug changes', async () => {
            const onChangeHandlers: Array<(e: any) => Promise<void>> = [];

            const values = new Map<string, any>([
                [settings.SETTING_ICS_EXPORT_LINK1_URL, 'javascript:alert(1)'],
                [settings.SETTING_ICS_EXPORT_LINK1_TITLE, '  ' + 'x'.repeat(100) + '  '],
                [settings.SETTING_DEBUG, true],
            ]);

            const joplin = {
                versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
                settings: {
                    registerSection: jest.fn().mockResolvedValue(undefined),
                    registerSettings: jest.fn().mockResolvedValue(undefined),
                    onChange: jest.fn(async (cb: any) => {
                        onChangeHandlers.push(cb);
                    }),
                    setValue: jest.fn(async (k: string, v: any) => {
                        values.set(k, v);
                    }),
                    value: jest.fn(async (k: string) => values.get(k)),
                },
            };

            await settings.registerSettings(joplin);

            // trigger onChange with URL + Title + Debug touched
            await onChangeHandlers[0]({
                keys: [
                    settings.SETTING_ICS_EXPORT_LINK1_URL,
                    settings.SETTING_ICS_EXPORT_LINK1_TITLE,
                    settings.SETTING_DEBUG,
                ],
            });

            // URL should be wiped
            expect(joplin.settings.setValue).toHaveBeenCalledWith(settings.SETTING_ICS_EXPORT_LINK1_URL, '');
            // Title should be trimmed+truncated to 60
            const titleSetCalls = (joplin.settings.setValue as any).mock.calls
                .filter((c: any[]) => c[0] === settings.SETTING_ICS_EXPORT_LINK1_TITLE);
            expect(titleSetCalls).toHaveLength(1);
            expect(String(titleSetCalls[0][1]).length).toBe(60);

            // Debug should update logger
            expect(setDebugEnabled).toHaveBeenCalledWith(true);
        });
    });

    describe('registerSettings', () => {
        test('registers SETTING_ICS_IMPORT_ALARMS_ENABLED with default false and bool type', async () => {
            const joplin = {
                versionInfo: jest.fn().mockResolvedValue({platform: 'desktop'}),
                settings: {
                    registerSection: jest.fn().mockResolvedValue(undefined),
                    registerSettings: jest.fn().mockResolvedValue(undefined),
                    // registerSettings() reads SETTING_DEBUG at the end
                    value: jest.fn().mockResolvedValue(false),

                    // optional, but keep stable if future code checks these
                    onChange: undefined,
                    setValue: undefined,
                },
            };

            await settings.registerSettings(joplin as any);

            expect(joplin.settings.registerSettings).toHaveBeenCalledTimes(1);
            const arg = joplin.settings.registerSettings.mock.calls[0][0];
            expect(arg[settings.SETTING_ICS_IMPORT_ALARMS_ENABLED]).toBeDefined();
            expect(arg[settings.SETTING_ICS_IMPORT_ALARMS_ENABLED].value).toBe(false);
            expect(arg[settings.SETTING_ICS_IMPORT_ALARMS_ENABLED].type).toBe(3); // bool
        });
    });
});
