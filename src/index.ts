// src/index.ts
// ЖОДНИХ import/require('api').
// Беремо API тільки з глобального об'єкта, який підкладає Joplin runner.

(function bootstrap() {
    const j: any = (globalThis as any).joplin || (window as any).joplin;

    if (!j) {
        // Ми не в плагін-раннері (або раннер ще не підкинув joplin) — нічого не робимо.
        console.log('[MyCalendar] no plugin API here (renderer).');
        return;
    }

    try {
        // ВАЖЛИВО: require pluginMain лише після того, як ми впевнились, що є joplin.
        // Таким чином Webpack не підвантажить залежності раніше (і не зламає renderer).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const runPlugin = require('./main/pluginMain').default;

        j.plugins.register({
            onStart: async () => {
                console.log('[MyCalendar] onStart (runner)');
                await runPlugin(j);
            },
        });
    } catch (e) {
        console.error('[MyCalendar] failed to start plugin', e);
    }
})();
