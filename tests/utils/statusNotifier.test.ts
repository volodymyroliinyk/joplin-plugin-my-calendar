import {createSafeTextReporter} from '../../src/main/utils/statusNotifier';

describe('statusNotifier.createSafeTextReporter', () => {
    test('forwards messages to the callback when provided', async () => {
        const onStatus = jest.fn().mockResolvedValue(undefined);

        const report = createSafeTextReporter(onStatus);
        await report('hello');

        expect(onStatus).toHaveBeenCalledWith('hello');
    });

    test('swallows callback failures', async () => {
        const onStatus = jest.fn().mockRejectedValue(new Error('fail'));

        const report = createSafeTextReporter(onStatus);

        await expect(report('hello')).resolves.toBeUndefined();
    });
});
