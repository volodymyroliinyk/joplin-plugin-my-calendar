import {getErrorText} from '../../src/main/utils/errorUtils';

describe('errorUtils.getErrorText', () => {
    test('returns message for Error instances', () => {
        expect(getErrorText(new Error('boom'))).toBe('boom');
    });

    test('falls back to string conversion for non-Error values', () => {
        expect(getErrorText(42)).toBe('42');
        expect(getErrorText(null)).toBe('null');
    });
});
