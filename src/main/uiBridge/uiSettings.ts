// src/main/uiBridge/uiSettings.ts

import * as settings from "../settings/settings";
import {setDebugEnabled} from "../utils/logger";

export async function pushUiSettings(joplin: any, panel: string) {
    const weekStart = await settings.getWeekStart(joplin);
    const debug = await settings.getDebugEnabled(joplin);

    // Backward-compatible for older/mocked settings modules in tests.
    const icsExportUrl =
        typeof (settings as any).getIcsExportUrl === 'function'
            ? await (settings as any).getIcsExportUrl(joplin)
            : '';

    // Main-side logger should follow the same setting
    setDebugEnabled(!!debug);

    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;

    await pm(panel, {name: 'uiSettings', weekStart, debug: !!debug, icsExportUrl});
}
