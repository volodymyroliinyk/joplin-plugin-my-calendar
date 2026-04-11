import {normalizeColorIfHex, normalizeHexColor} from '../../src/main/utils/colorUtils';

describe('colorUtils', () => {
    test('normalizeHexColor lowercases valid 3/6-digit hex', () => {
        expect(normalizeHexColor('#ABC', {allowShort: true})).toBe('#abc');
        expect(normalizeHexColor('#A1B2C3', {allowShort: true})).toBe('#a1b2c3');
    });

    test('normalizeHexColor rejects invalid values and 3-digit when disallowed', () => {
        expect(normalizeHexColor('red', {allowShort: true})).toBe('');
        expect(normalizeHexColor('#abc', {allowShort: false})).toBe('');
    });

    test('normalizeColorIfHex lowercases hex but preserves non-hex text', () => {
        expect(normalizeColorIfHex('#AABBCC', {allowShort: true})).toBe('#aabbcc');
        expect(normalizeColorIfHex('DodgerBlue', {allowShort: true})).toBe('DodgerBlue');
    });
});
