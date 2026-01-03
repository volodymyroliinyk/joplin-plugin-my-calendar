// tests/utils/logger.test.ts
// src/main/utils/logger.ts
//
// npx jest tests/utils/logger.test.ts --runInBand --no-cache;
//
import {setDebugEnabled, dbg, info, warn, err} from '../../src/main/utils/logger';

describe('logger', () => {
    let logSpy: jest.SpyInstance;
    let warnSpy: jest.SpyInstance;
    let errorSpy: jest.SpyInstance;

    beforeEach(() => {
        // if jest.config has restoreMocks:true - spy must be set AGAIN before each test
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        setDebugEnabled(false);
    });

    afterEach(() => {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        errorSpy.mockRestore();
    });

    test('dbg does nothing when debug disabled', () => {
        dbg('a', 1);
        expect(logSpy).not.toHaveBeenCalled();
    });

    test('dbg logs when debug enabled', () => {
        setDebugEnabled(true);
        dbg('a', 1);
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar]', 'a', 1);
    });

    test('info always logs with prefix', () => {
        info('x');
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar]', 'x');
    });

    test('warn logs with prefix', () => {
        warn('w');
        expect(warnSpy).toHaveBeenCalledWith('[MyCalendar]', 'w');
    });

    test('err logs with prefix', () => {
        err('e');
        expect(errorSpy).toHaveBeenCalledWith('[MyCalendar]', 'e');
    });

    test('setDebugEnabled affects subsequent dbg calls', () => {
        dbg('no');
        setDebugEnabled(true);
        dbg('yes');
        setDebugEnabled(false);
        dbg('no2');

        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith('[MyCalendar]', 'yes');
    });
});
