// src/main/uiBridge/uiSettings.ts

import * as settings from '../settings/settings';
import {setDebugEnabled} from '../utils/logger';

export const UI_SETTINGS_MESSAGE_NAME = 'uiSettings';

export type IcsExportLink = { title: string; url: string };

export type UiSettingsMessage = {
    name: typeof UI_SETTINGS_MESSAGE_NAME;
    weekStart: settings.WeekStart;
    debug: boolean;
    icsExportLinks: IcsExportLink[];
    dayEventsRefreshMinutes: number;
    showEventTimeline: boolean;
    defaultEventColor: string;
    defaultEventColorLight: string;
    defaultEventColorDark: string;
    timelineNowLineColor: string;
    timelineNowLineColorLight: string;
    timelineNowLineColorDark: string;
    showWeekNumbers: boolean;
    timeFormat: settings.TimeFormat;
    dayEventsViewMode: settings.DayEventsViewMode;
    scheduledIcsImportAvailable: boolean;
};

type JoplinLike = {
    settings?: settings.SettingsReader['settings'];
    versionInfo?: () => Promise<{ platform?: string }>;
    views?: {
        panels?: {
            postMessage?: (panel: string, message: unknown) => Promise<void>;
        };
    };
};

async function isScheduledIcsImportAvailable(joplin: unknown): Promise<boolean> {
    const versionInfo = (joplin as JoplinLike)?.versionInfo;
    if (typeof versionInfo !== 'function') return true;
    try {
        const info = await versionInfo();
        return String(info?.platform ?? '').toLowerCase() !== 'mobile';
    } catch {
        return true;
    }
}

type SettingsWithOptionalIcs = typeof settings & {
    getIcsExportLinks?: (joplin: settings.SettingsReader) => Promise<IcsExportLink[]>;
};

async function getIcsExportLinksCompat(joplin: settings.SettingsReader): Promise<IcsExportLink[]> {
    const s = settings as SettingsWithOptionalIcs;
    return typeof s.getIcsExportLinks === 'function' ? await s.getIcsExportLinks(joplin) : [];
}

/**
 * Reads UI-relevant settings from the main process.
 * Separated for easier unit testing and future reuse.
 */
export async function buildUiSettingsMessage(joplin: JoplinLike): Promise<UiSettingsMessage> {
    // Production always provides settings; tests may replace every getter with mocks.
    const settingsReader = joplin as settings.SettingsReader;
    const [
        weekStart,
        debugRaw,
        icsExportLinks,
        dayEventsRefreshMinutes,
        showEventTimeline,
        defaultEventColor,
        defaultEventColorLight,
        defaultEventColorDark,
        timelineNowLineColor,
        timelineNowLineColorLight,
        timelineNowLineColorDark,
        showWeekNumbers,
        timeFormat,
        dayEventsViewMode,
        scheduledIcsImportAvailable,
    ] = await Promise.all([
        settings.getWeekStart(settingsReader),
        settings.getDebugEnabled(settingsReader),
        getIcsExportLinksCompat(settingsReader),
        settings.getDayEventsRefreshMinutes(settingsReader),
        settings.getShowEventTimeline(settingsReader),
        settings.getDefaultEventColor(settingsReader),
        settings.getDefaultEventColorLight(settingsReader),
        settings.getDefaultEventColorDark(settingsReader),
        settings.getTimelineNowLineColor(settingsReader),
        settings.getTimelineNowLineColorLight(settingsReader),
        settings.getTimelineNowLineColorDark(settingsReader),
        settings.getShowWeekNumbers(settingsReader),
        settings.getTimeFormat(settingsReader),
        settings.getDayEventsViewMode(settingsReader),
        isScheduledIcsImportAvailable(joplin),
    ]);

    const debugEnabled = Boolean(debugRaw);

    // Main-side logger should follow the same setting
    setDebugEnabled(debugEnabled);

    const message: UiSettingsMessage = {
        name: UI_SETTINGS_MESSAGE_NAME,
        weekStart,
        debug: debugEnabled,
        icsExportLinks,
        dayEventsRefreshMinutes,
        showEventTimeline,
        defaultEventColor,
        defaultEventColorLight,
        defaultEventColorDark,
        timelineNowLineColor,
        timelineNowLineColorLight,
        timelineNowLineColorDark,
        showWeekNumbers,
        timeFormat,
        dayEventsViewMode,
        scheduledIcsImportAvailable,
    };

    return message;
}

export async function pushUiSettings(joplin: JoplinLike, panel: string): Promise<void> {
    const message = await buildUiSettingsMessage(joplin);
    const pm = joplin?.views?.panels?.postMessage;
    if (typeof pm !== 'function') return;
    await pm(panel, message);
}
