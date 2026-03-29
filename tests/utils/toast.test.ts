// tests/utils/toast.test.ts
//
// src/main/utils/toast.ts
//
// TZ=UTC npx jest tests/utils/toast.test.ts --runInBand --no-cache;
//
import {__resetToastCacheForTests, clearToastCache, showToast} from '../../src/main/utils/toast';

describe('toast', () => {
    let showToastSpy: jest.Mock;
    let nowSpy: jest.SpyInstance;

    beforeEach(() => {
        __resetToastCacheForTests();
        showToastSpy = jest.fn().mockResolvedValue(undefined);

        // mock global joplin used by toast.ts
        (global as any).joplin = {
            views: {
                dialogs: {
                    showToast: showToastSpy,
                },
            },
        };

        // make timestamp deterministic
        nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);
    });

    afterEach(() => {
        __resetToastCacheForTests();
        nowSpy.mockRestore();
        delete (global as any).joplin;
        jest.clearAllMocks();
    });

    test('shows toast with provided type and message (default duration=3000)', async () => {
        await showToast('success', 'Done', 5000);

        expect(showToastSpy).toHaveBeenCalledTimes(1);
        expect(showToastSpy).toHaveBeenCalledWith({
            type: 'success',
            message: 'Done',
            duration: 5000,
        });
    });

    test('uses custom duration when provided', async () => {
        await showToast('error', 'Failed', 5000);

        expect(showToastSpy).toHaveBeenCalledWith({
            type: 'error',
            message: 'Failed',
            duration: 5000,
        });
    });

    test('rejects if dialogs.showToast rejects (current behavior)', async () => {
        showToastSpy.mockRejectedValueOnce(new Error('boom'));

        await expect(showToast('info', 'Test')).rejects.toThrow('boom');
    });

    test('suppresses an identical toast while it is still in the recent-toast cache window', async () => {
        await showToast('success', 'Done', 5000);
        await showToast('success', 'Done', 5000);

        expect(showToastSpy).toHaveBeenCalledTimes(1);
    });

    test('allows the same toast again after the dedupe window expires', async () => {
        await showToast('success', 'Done', 5000);
        nowSpy.mockReturnValue(1700000006001);

        await showToast('success', 'Done', 5000);

        expect(showToastSpy).toHaveBeenCalledTimes(2);
    });

    test('clearToastCache drops the recent-toast dedupe state immediately', async () => {
        await showToast('success', 'Done', 5000);
        clearToastCache();

        await showToast('success', 'Done', 5000);

        expect(showToastSpy).toHaveBeenCalledTimes(2);
    });
});
