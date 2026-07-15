// src/index.ts

// The runner exposes Joplin through the global scope. Do not import `api` here:
// loading plugin modules before confirming the runner API is available breaks renderer contexts.

type PluginRegistration = {
    onStart: () => Promise<void>;
};

type RunnerJoplinApi = {
    plugins: {
        register: (plugin: PluginRegistration) => void;
    };
};

type RunnerGlobal = typeof globalThis & {
    joplin?: RunnerJoplinApi;
};

type PluginRunner = (joplin: RunnerJoplinApi) => Promise<void>;

(function bootstrap(): void {
    const joplinApi = (globalThis as RunnerGlobal).joplin;

    if (!joplinApi) {
        // Renderer contexts do not provide the plugin runner API.
        console.log('[MyCalendar] no plugin API here (renderer).');
        return;
    }

    try {
        // Load the plugin only after confirming that the runner API exists.

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const runPlugin = require('./main/pluginMain').default as PluginRunner;

        joplinApi.plugins.register({
            onStart: async () => {
                try {
                    console.log('[MyCalendar] onStart (runner)');
                    await runPlugin(joplinApi);
                } catch (error) {
                    console.error('[MyCalendar] onStart error (caught):', error);
                }
            },
        });
    } catch (error) {
        console.error('[MyCalendar] failed to start plugin', error);
    }
})();
