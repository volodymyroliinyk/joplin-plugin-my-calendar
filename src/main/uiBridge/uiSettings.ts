// src/main/uiBridge/uiSettings.ts

import * as settings from '../settings/settings';
import {setDebugEnabled} from '../utils/logger';

export const UI_SETTINGS_MESSAGE_NAME = 'uiSettings';

export type IcsExportLink = { title: string; url: string };

export type UiSettingsMessage = {
    name: typeof UI_SETTINGS_MESSAGE_NAME;
    weekStart: unknown;
    debug: boolean;
    icsExportLinks: IcsExportLink[];
    dayEventsRefreshMinutes: unknown;
    showEventTimeline: boolean;
    showWeekNumbers: boolean;
    timeFormat: settings.TimeFormat;
    dayEventsViewMode: settings.DayEventsViewMode;
};

type JoplinLike = {
    views?: {
        panels?: {
            postMessage?: (panel: string, message: unknown) => Promise<void>;
        };
    };
};

type SettingsWithOptionalIcs = typeof settings & {
    getIcsExportLinks?: (joplin: unknown) => Promise<IcsExportLink[]>;
};

async function getIcsExportLinksCompat(joplin: unknown): Promise<IcsExportLink[]> {
    const s = settings as SettingsWithOptionalIcs;
    return typeof s.getIcsExportLinks === 'function' ? await s.getIcsExportLinks(joplin) : [];
}

/**
 * Reads UI-relevant settings from the main process.
 * Separated for easier unit testing and future reuse.
 */
export async function buildUiSettingsMessage(joplin: unknown): Promise<UiSettingsMessage> {
    const [weekStart, debugRaw, icsExportLinks, dayEventsRefreshMinutes, showEventTimeline, showWeekNumbers, timeFormat, dayEventsViewMode] = await Promise.all([
        settings.getWeekStart(joplin as any),
        settings.getDebugEnabled(joplin as any),
        getIcsExportLinksCompat(joplin),
        settings.getDayEventsRefreshMinutes(joplin as any),
        settings.getShowEventTimeline(joplin as any),
        settings.getShowWeekNumbers(joplin as any),
        settings.getTimeFormat(joplin as any),
        settings.getDayEventsViewMode(joplin as any),
    ]);

    const debugEnabled = Boolean(debugRaw);

    // Main-side logger should follow the same setting
    setDebugEnabled(debugEnabled);

    return {
        name: UI_SETTINGS_MESSAGE_NAME,
        weekStart,
        debug: debugEnabled,
        icsExportLinks,
        dayEventsRefreshMinutes,
        showEventTimeline,
        showWeekNumbers,
        timeFormat,
        dayEventsViewMode,
    };
}

export async function pushUiSettings(joplin: JoplinLike, panel: string): Promise<void> {
    const message = await buildUiSettingsMessage(joplin);
    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;
    await pm(panel, message);
}
