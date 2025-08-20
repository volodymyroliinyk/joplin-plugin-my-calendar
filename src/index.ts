// src/index.ts
// NOT ONE import/require('api').
// We only take API from a global object that plays Joplen Runner.

(function bootstrap() {
    const j: any = (globalThis as any).joplin || (window as any).joplin;

    if (!j) {
        // We are not in the plugin-wounder (or Ranner have not yet thrown Joplin)-we do nothing.
        console.log('[MyCalendar] no plugin API here (renderer).');
        return;
    }

    try {
        // IMPORTANT: REQUIRE PLUGINMAIN only after we've been convinced that there was a joplin.
        // This way webpack will not overload the addiction earlier (and will not break RENDER).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const runPlugin = require('./main/pluginMain').default;

        j.plugins.register({
            onStart: async () => {
                try {
                    console.log('[MyCalendar] onStart (runner)');
                    await runPlugin(j);
                } catch (e) {
                    console.error('[MyCalendar] onStart error (caught):', e);
                }
            },
        });
    } catch (e) {
        console.error('[MyCalendar] failed to start plugin', e);
    }
})();
