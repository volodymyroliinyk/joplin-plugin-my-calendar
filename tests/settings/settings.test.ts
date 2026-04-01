// tests/settings/settings.test.ts
//
// src/main/settings/settings.ts
//
// TZ=UTC npx jest tests/settings/settings.test.ts --runInBand --no-cache;
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

    describe('sanitizeSecureExternalUrl', () => {
        test('keeps valid https URLs only', () => {
            expect(settings.sanitizeSecureExternalUrl('https://example.com/a.ics')).toBe('https://example.com/a.ics');
            expect(settings.sanitizeSecureExternalUrl('http://example.com/a.ics')).toBe('');
        });
    });

    describe('parseAutomatedIcsImportEntries', () => {
        test('keeps only unique valid https URL + notebook title pairs', () => {
            const raw = [
                'https://example.com/a.ics | Work',
                'http://example.com/b.ics | Bad',
                'https://example.com/c.ics',
                'https://example.com/a.ics | Work',
                'https://example.com/c.ics | Personal',
            ].join(' ;; ');

            expect(settings.parseAutomatedIcsImportEntries(raw)).toEqual([
                {url: 'https://example.com/a.ics', notebookTitle: 'Work'},
                {url: 'https://example.com/c.ics', notebookTitle: 'Personal'},
            ]);
        });

        test('keeps all valid pairs without a legacy 4-item cap', () => {
            const raw = [
                'https://example.com/1.ics | Work',
                'https://example.com/2.ics | Personal',
                'https://example.com/3.ics | Family',
                'https://example.com/4.ics | Travel',
                'https://example.com/5.ics | Birthdays',
                'https://example.com/6.ics | Projects',
            ].join(' ;; ');

            expect(settings.parseAutomatedIcsImportEntries(raw)).toEqual([
                {url: 'https://example.com/1.ics', notebookTitle: 'Work'},
                {url: 'https://example.com/2.ics', notebookTitle: 'Personal'},
                {url: 'https://example.com/3.ics', notebookTitle: 'Family'},
                {url: 'https://example.com/4.ics', notebookTitle: 'Travel'},
                {url: 'https://example.com/5.ics', notebookTitle: 'Birthdays'},
                {url: 'https://example.com/6.ics', notebookTitle: 'Projects'},
            ]);
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

    describe('getDayEventsViewMode logic', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)}
        });

        test('returns grouped only for supported enum value', async () => {
            expect(await settings.getDayEventsViewMode(mkJoplin('grouped'))).toBe('grouped');
        });

        test('falls back to single for invalid or missing value', async () => {
            expect(await settings.getDayEventsViewMode(mkJoplin('other'))).toBe('single');
            expect(await settings.getDayEventsViewMode(mkJoplin(null))).toBe('single');
        });
    });

    describe('getIcsExportLinks filtering and sanitization', () => {
        test('parses new export link pairs format, filters invalid URLs, and sanitizes titles', async () => {
            const mockJoplin = {
                settings: {
                    value: jest.fn().mockImplementation((key) => {
                        if (key === settings.SETTING_ICS_EXPORT_LINK_PAIRS) {
                            return ` Good Link | https://ok.com ;;
                                Bad | javascript:alert(1) ;;
                                ${'x'.repeat(100)} | http://ok2.com `;
                        }
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

        test('returns all valid export pairs without a legacy 4-item cap', async () => {
            const mockJoplin = {
                settings: {
                    value: jest.fn().mockImplementation((key) => {
                        if (key === settings.SETTING_ICS_EXPORT_LINK_PAIRS) {
                            return [
                                'One | https://example.test/1.ics',
                                'Two | https://example.test/2.ics',
                                'Three | https://example.test/3.ics',
                                'Four | https://example.test/4.ics',
                                'Five | https://example.test/5.ics',
                                'Six | https://example.test/6.ics',
                            ].join(' ;; ');
                        }
                        return '';
                    }),
                },
            };

            await expect(settings.getIcsExportLinks(mockJoplin)).resolves.toEqual([
                {title: 'One', url: 'https://example.test/1.ics'},
                {title: 'Two', url: 'https://example.test/2.ics'},
                {title: 'Three', url: 'https://example.test/3.ics'},
                {title: 'Four', url: 'https://example.test/4.ics'},
                {title: 'Five', url: 'https://example.test/5.ics'},
                {title: 'Six', url: 'https://example.test/6.ics'},
            ]);
        });

        test('falls back to legacy export link fields when new pairs field is empty', async () => {
            const mockJoplin = {
                settings: {
                    value: jest.fn().mockImplementation((key) => {
                        if (key === settings.SETTING_ICS_EXPORT_LINK_PAIRS) return '';
                        if (key.includes('Link1Title')) return ' Work ';
                        if (key.includes('Link1Url')) return 'https://example.test/work.ics';
                        return '';
                    }),
                },
            };

            await expect(settings.getIcsExportLinks(mockJoplin)).resolves.toEqual([
                {title: 'Work', url: 'https://example.test/work.ics'},
            ]);
        });
    });

    describe('automated ICS import settings helpers', () => {
        const mkJoplin = (map: Record<string, any>) => ({
            settings: {
                value: jest.fn(async (key: string) => map[key]),
            },
        });

        test('getAutomatedIcsImportEntries returns sanitized HTTPS URL + notebook title pairs only', async () => {
            const joplin = mkJoplin({
                [settings.SETTING_ICS_AUTO_IMPORT_PAIRS]: 'https://example.com/a.ics | Work ;; http://bad.test/x.ics | Bad ;; https://example.com/b.ics | Personal',
            });

            await expect(settings.getAutomatedIcsImportEntries(joplin)).resolves.toEqual([
                {url: 'https://example.com/a.ics', notebookTitle: 'Work'},
                {url: 'https://example.com/b.ics', notebookTitle: 'Personal'},
            ]);
        });

        test('getAutomatedIcsImportIntervalMinutes clamps to 5-1440 with default 60', async () => {
            await expect(settings.getAutomatedIcsImportIntervalMinutes(mkJoplin({
                [settings.SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES]: null,
            }))).resolves.toBe(60);

            await expect(settings.getAutomatedIcsImportIntervalMinutes(mkJoplin({
                [settings.SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES]: 1,
            }))).resolves.toBe(5);

            await expect(settings.getAutomatedIcsImportIntervalMinutes(mkJoplin({
                [settings.SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES]: 5000,
            }))).resolves.toBe(1440);
        });

        test('sanitizeNotebookTitle trims unsafe whitespace', () => {
            expect(settings.sanitizeNotebookTitle('  Work\t')).toBe('Work');
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

    describe('getShowWeekNumbers', () => {
        const mkJoplin = (val: any) => ({
            settings: {value: jest.fn().mockResolvedValue(val)},
        });

        test('coerces to boolean', async () => {
            await expect(settings.getShowWeekNumbers(mkJoplin(true))).resolves.toBe(true);
            await expect(settings.getShowWeekNumbers(mkJoplin(false))).resolves.toBe(false);
            await expect(settings.getShowWeekNumbers(mkJoplin(null))).resolves.toBe(false);
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
        test('sanitizes touched export pairs and updates logger when debug changes', async () => {
            const onChangeHandlers: Array<(e: any) => Promise<void>> = [];

            const values = new Map<string, any>([
                [settings.SETTING_ICS_EXPORT_LINK_PAIRS, `  ${'x'.repeat(100)} | https://ok.test/a.ics ;; Bad | javascript:alert(1) `],
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

            // trigger onChange with export pairs + Debug touched
            await onChangeHandlers[0]({
                keys: [
                    settings.SETTING_ICS_EXPORT_LINK_PAIRS,
                    settings.SETTING_DEBUG,
                ],
            });

            expect(joplin.settings.setValue).toHaveBeenCalledWith(
                settings.SETTING_ICS_EXPORT_LINK_PAIRS,
                `${'x'.repeat(60)} | https://ok.test/a.ics`,
            );

            // Debug should update logger
            expect(setDebugEnabled).toHaveBeenCalledWith(true);
        });

        test('sanitizes automated import pairs to HTTPS-only ;;-separated url|title values', async () => {
            const onChangeHandlers: Array<(e: any) => Promise<void>> = [];

            const values = new Map<string, any>([
                [settings.SETTING_ICS_AUTO_IMPORT_PAIRS, ' https://example.com/a.ics | Work ;; http://bad.test/b.ics | Bad ;; https://example.com/a.ics | Work '],
                [settings.SETTING_DEBUG, false],
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

            await settings.registerSettings(joplin as any);
            await onChangeHandlers[0]({keys: [settings.SETTING_ICS_AUTO_IMPORT_PAIRS]});

            expect(joplin.settings.setValue).toHaveBeenCalledWith(
                settings.SETTING_ICS_AUTO_IMPORT_PAIRS,
                'https://example.com/a.ics | Work',
            );
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
            expect(arg[settings.SETTING_ICS_AUTO_IMPORT_PAIRS]).toBeDefined();
            expect(arg[settings.SETTING_ICS_EXPORT_LINK_PAIRS]).toBeDefined();
            expect(arg[settings.SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES].value).toBe(60);
            expect(arg[settings.SETTING_DAY_EVENTS_VIEW_MODE]).toBeDefined();
            expect(arg[settings.SETTING_DAY_EVENTS_VIEW_MODE].value).toBe('single');
            expect(arg[settings.SETTING_DAY_EVENTS_VIEW_MODE].isEnum).toBe(true);
        });
    });
});
