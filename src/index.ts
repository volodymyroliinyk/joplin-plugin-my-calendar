// src/index.ts
// Не імпортуємо 'api' зверху — це може зламати renderer без модуля.
// Обережно визначаємо, чи ми в плагін-раннері Joplin.

(function bootstrap() {
    // 1) Спробувати взяти глобальний joplin (деякі версії раннера так його віддають)
    let j: any = (globalThis as any).joplin;

    // 2) Якщо глобального немає — пробуємо require('api'), але ТІЛЬКИ якщо require існує
    if (!j && typeof require === 'function') {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            j = require('api');
        } catch (e) {
            // Ми не в раннері (наприклад, у webview) — тихо виходимо
            console.log('[MyCalendar] no plugin API here (renderer).');
            return;
        }
    }

    if (!j) {
        // Немає ані глобального joplin, ані модуля api — значить це не той процес.
        console.log('[MyCalendar] no plugin API (unknown env).');
        return;
    }

    // Тепер точно маємо API раннера
    try {
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
