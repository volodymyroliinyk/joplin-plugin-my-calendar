// src/main/uiBridge/uiSettings.ts

import {getDebugEnabled, getWeekStart} from "../settings/settings";
import {setDebugEnabled} from "../utils/logger";


export async function pushUiSettings(joplin: any, panel: string) {
    const weekStart = await getWeekStart(joplin);
    // console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    const debug = await getDebugEnabled(joplin);

    // Main-side logger should follow the same setting
    setDebugEnabled(!!debug);

    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;
    // console.log('[MyCalendar][DBG][weekStart] weekStart 1::', weekStart);
    await pm(panel, {name: 'uiSettings', weekStart, debug: !!debug});
}
