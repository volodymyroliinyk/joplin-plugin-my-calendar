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
});
