// tests/services/eventsCache.test.ts
//
// src/main/services/eventsCache.ts
//
// npx jest tests/services/eventsCache.test.ts --runInBand --no-cache;
//
type JoplinMock = {
    data: {
        get: jest.Mock<any, any>;
    };
};

const mkJoplin = (getImpl: JoplinMock['data']['get']): JoplinMock => ({
    data: {get: getImpl},
});

describe('eventsCache.ts', () => {
    // Silence noisy logs
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => {
        });
        jest.spyOn(console, 'error').mockImplementation(() => {
        });
    });

    afterEach(() => {
        // if restoreMocks=true, this is optional, but useful for local clarity
        (console.log as jest.Mock | any).mockRestore?.();
        (console.error as jest.Mock | any).mockRestore?.();
    });

    /**
     * Important: eventsCache has module-level state.
     * For "clean" tests, each test reloads the module.
     */
    async function loadModuleWithMockedParser(parserMock: {
        parseEventsFromBody: jest.Mock;
    }) {
        jest.resetModules();

        jest.doMock('../../src/main/parsers/eventParser', () => ({
            parseEventsFromBody: parserMock.parseEventsFromBody,
        }));

        // import after doMock
        const mod = await import('../../src/main/services/eventsCache');
        return mod;
    }

    test('ensureAllEventsCache triggers rebuild when cache is empty', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);
        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({items: [], has_more: false}),
        );

        const all = await mod.ensureAllEventsCache(joplin);

        expect(joplin.data.get).toHaveBeenCalledTimes(1);
        expect(joplin.data.get).toHaveBeenCalledWith(['notes'], {
            fields: ['id', 'title', 'body'],
            limit: 100,
            page: 1,
        });

        expect(all).toEqual([]);
        expect(parseEventsFromBody).not.toHaveBeenCalled(); // items = []
    });

    test('ensureAllEventsCache does NOT rebuild when cache already exists', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([
            {id: 'note-1', title: 't', startText: '2025-01-01T00:00:00Z', startUtc: 1},
        ]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({
                items: [{id: 'note-1', title: 'T', body: 'body'}],
                has_more: false,
            }),
        );

        const all1 = await mod.ensureAllEventsCache(joplin);
        const all2 = await mod.ensureAllEventsCache(joplin);

        expect(joplin.data.get).toHaveBeenCalledTimes(1);
        expect(parseEventsFromBody).toHaveBeenCalledTimes(1);

        expect(all1).toHaveLength(1);
        expect(all2).toHaveLength(1);
    });

    test('rebuildAllEventsCache paginates while has_more=true', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const get = jest
            .fn()
            .mockResolvedValueOnce({
                items: [{id: '1', title: 'A', body: 'x'}],
                has_more: true,
            })
            .mockResolvedValueOnce({
                items: [{id: '2', title: 'B', body: 'y'}],
                has_more: false,
            });

        const joplin = mkJoplin(get);

        await mod.rebuildAllEventsCache(joplin);

        expect(get).toHaveBeenCalledTimes(2);
        expect(get).toHaveBeenNthCalledWith(1, ['notes'], {
            fields: ['id', 'title', 'body'],
            limit: 100,
            page: 1,
        });
        expect(get).toHaveBeenNthCalledWith(2, ['notes'], {
            fields: ['id', 'title', 'body'],
            limit: 100,
            page: 2,
        });
    });

    test('skips notes with missing id or missing body (does not call parser)', async () => {
        const parseEventsFromBody = jest.fn();

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({
                items: [
                    {id: '', title: 'NoId', body: 'x'},
                    {id: 'ok', title: 'NoBody', body: ''},
                    {id: 'ok2', title: 'BodyNotString', body: 123},
                    {id: 'ok3', title: 'Good', body: 'good body'},
                ],
                has_more: false,
            }),
        );

        parseEventsFromBody.mockReturnValueOnce([]); // for ok3

        const all = await mod.ensureAllEventsCache(joplin);

        expect(parseEventsFromBody).toHaveBeenCalledTimes(1);
        expect(parseEventsFromBody).toHaveBeenCalledWith('ok3', 'Good', 'good body');
        expect(all).toEqual([]);
    });

    test('stores noteId into each returned event object', async () => {
        const parseEventsFromBody = jest.fn().mockImplementation((id: string) => [
            {id, title: 'E1', startText: '2025-01-01T00:00:00Z', startUtc: 1},
            {id, title: 'E2', startText: '2025-01-02T00:00:00Z', startUtc: 2},
        ]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({
                items: [{id: 'note-77', title: 'Note', body: 'body'}],
                has_more: false,
            }),
        );

        const all = await mod.ensureAllEventsCache(joplin);

        expect(all).toHaveLength(2);
        expect((all[0] as any).noteId).toBe('note-77');
        expect((all[1] as any).noteId).toBe('note-77');
    });

    test('skips note when parser returns empty events', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({
                items: [{id: 'n1', title: 'T', body: 'body'}],
                has_more: false,
            }),
        );

        const all = await mod.ensureAllEventsCache(joplin);

        expect(parseEventsFromBody).toHaveBeenCalledTimes(1);
        expect(all).toEqual([]);
    });

    test('rebuildAllEventsCache is guarded by rebuilding flag (second call returns early)', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        let resolveGet!: (v: any) => void;
        const getPromise = new Promise((res) => {
            resolveGet = res;
        });

        const get = jest.fn().mockReturnValue(getPromise);
        const joplin = mkJoplin(get);

        const p1 = mod.rebuildAllEventsCache(joplin);
        const p2 = mod.rebuildAllEventsCache(joplin); // should return immediately

        // friend should not do another get
        expect(get).toHaveBeenCalledTimes(1);

        resolveGet({items: [], has_more: false});

        await Promise.all([p1, p2]);
    });

    test('on error: rebuild catches (no throw), keeps cache usable, and releases rebuilding flag so rebuild can be called again', async () => {
        // 1) arrange
        const parseEventsFromBody = jest.fn().mockReturnValue([]);
        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const logger = await import('../../src/main/utils/logger');
        const errSpy = jest.spyOn(logger, 'err').mockImplementation(() => undefined);

        const getMock = jest.fn().mockRejectedValue(new Error('boom'));
        const joplin = mkJoplin(getMock);

        // 2) act + assert: rebuild should not throw further, even if joplin.data.get crashes
        await expect(mod.rebuildAllEventsCache(joplin)).resolves.toBeUndefined();

        // 3) assert: the error was logged
        expect(errSpy).toHaveBeenCalledWith('eventsCache', 'Error rebuilding events cache:', expect.any(Error));

        // 4) act + assert: after an error, the cache does not "break" - ensure returns []
        // (in your code allEventsCache becomes allEventsCache || [] in catch)
        const all = await mod.ensureAllEventsCache(joplin);
        expect(all).toEqual([]);

        // 5) act + assert: rebuilding flag released - rebuild can be called again
        await expect(mod.rebuildAllEventsCache(joplin)).resolves.toBeUndefined();

        // 6) assert: data.get is called 2 times (two rebuild attempts)
        expect(getMock).toHaveBeenCalledTimes(2);

        errSpy.mockRestore();
    });


    test('invalidateNote forces next ensureAllEventsCache to rebuild', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({items: [], has_more: false}),
        );

        await mod.ensureAllEventsCache(joplin);
        expect(joplin.data.get).toHaveBeenCalledTimes(1);

        mod.invalidateNote('any-note');

        await mod.ensureAllEventsCache(joplin);
        expect(joplin.data.get).toHaveBeenCalledTimes(2);
    });

    test('invalidateAllEventsCache clears and forces rebuild', async () => {
        const parseEventsFromBody = jest.fn().mockReturnValue([]);

        const mod = await loadModuleWithMockedParser({parseEventsFromBody});

        const joplin = mkJoplin(
            jest.fn().mockResolvedValue({items: [], has_more: false}),
        );

        await mod.ensureAllEventsCache(joplin);
        expect(joplin.data.get).toHaveBeenCalledTimes(1);

        mod.invalidateAllEventsCache();

        await mod.ensureAllEventsCache(joplin);
        expect(joplin.data.get).toHaveBeenCalledTimes(2);
    });
});
