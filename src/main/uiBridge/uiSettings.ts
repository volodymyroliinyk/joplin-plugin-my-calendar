// src/main/uiBridge/uiSettings.ts

import * as settings from '../settings/settings';
import {setDebugEnabled} from '../utils/logger';

type JoplinLike = {
    views?: {
        panels?: {
            postMessage?: (panel: string, message: unknown) => Promise<void>;
        };
    };
};

type SettingsWithOptionalIcs = typeof settings & {
    getIcsExportUrl?: (joplin: unknown) => Promise<string>;
};

async function getIcsExportUrlCompat(joplin: unknown): Promise<string> {
    const s = settings as SettingsWithOptionalIcs;
    return typeof s.getIcsExportUrl === 'function' ? await s.getIcsExportUrl(joplin) : '';
}

export async function pushUiSettings(joplin: JoplinLike, panel: string): Promise<void> {
    const weekStart = await settings.getWeekStart(joplin as any);
    const debugEnabled = Boolean(await settings.getDebugEnabled(joplin as any));
    const icsExportUrl = await getIcsExportUrlCompat(joplin);
    const dayEventsRefreshMinutes = await settings.getDayEventsRefreshMinutes(joplin as any);

    // Main-side logger should follow the same setting
    setDebugEnabled(debugEnabled);

    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;

    await pm(panel, {
        name: 'uiSettings',
        weekStart,
        debug: debugEnabled,
        icsExportUrl,
        dayEventsRefreshMinutes,
    });
}
