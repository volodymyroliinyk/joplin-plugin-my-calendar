// src/index.ts

// ВАЖЛИВО: один і той самий бандл вантажиться і в main (Node), і у webview (browser).
// Тому ніде не робимо top-level import 'api'!
// У браузері просто нічого не робимо.

(function bootstrap() {
    const isNode = typeof (globalThis as any).process === 'object'
        && !!(globalThis as any).process?.versions?.node;

    if (!isNode) {
        // renderer/webview — no-op
        console.log('[MyCalendar] renderer: no-op');
        return;
    }

    // main/Node гілка — тут можна require('api')
    let joplin: any;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        joplin = require('api');
    } catch (e) {
        console.error('[MyCalendar] main: cannot require api', e);
        return;
    }

    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const runPlugin = require('./main/pluginMain').default;
        joplin.plugins.register({
            onStart: async () => {
                console.log('[MyCalendar] main: onStart');
                await runPlugin(joplin);
            },
        });
    } catch (e) {
        console.error('[MyCalendar] main: failed to start', e);
    }
})();
