describe('index bootstrap', () => {
    const originalJoplin = (globalThis as any).joplin;

    beforeEach(() => {
        jest.resetModules();
        delete (globalThis as any).joplin;
    });

    afterAll(() => {
        if (originalJoplin === undefined) {
            delete (globalThis as any).joplin;
        } else {
            (globalThis as any).joplin = originalJoplin;
        }
    });

    test('does not throw when plugin API is missing and window is not defined', () => {
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {
            // silence in test output
        });

        expect(() => {
            jest.isolateModules(() => {
                require('../src/index');
            });
        }).not.toThrow();

        expect(logSpy).toHaveBeenCalledWith('[MyCalendar] no plugin API here (renderer).');
    });

    test('registers plugin and runs pluginMain onStart when joplin exists on globalThis', async () => {
        const runPlugin = jest.fn().mockResolvedValue(undefined);
        jest.doMock('../src/main/pluginMain', () => ({
            __esModule: true,
            default: runPlugin,
        }));

        const register = jest.fn();
        const fakeJoplin = {
            plugins: {
                register,
            },
        };
        (globalThis as any).joplin = fakeJoplin;

        jest.isolateModules(() => {
            require('../src/index');
        });

        expect(register).toHaveBeenCalledTimes(1);
        const registration = register.mock.calls[0][0];
        expect(registration).toEqual(expect.objectContaining({onStart: expect.any(Function)}));

        await registration.onStart();
        expect(runPlugin).toHaveBeenCalledWith(fakeJoplin);
    });
});
