// src/main/settings/settings.ts

import {setDebugEnabled} from '../utils/logger';
import {normalizeHexColor} from '../utils/colorUtils';

export type SettingsReader = {
    settings: {
        value: (key: string) => Promise<unknown>;
    };
};

type SettingsChangeEvent = { keys?: string[] };

type SettingsRegistrar = SettingsReader & {
    settings: SettingsReader['settings'] & {
        setValue?: (key: string, value: unknown) => Promise<void>;
        onChange?: (callback: (event: SettingsChangeEvent) => void | Promise<void>) => Promise<void>;
        registerSection?: (id: string, options: Record<string, unknown>) => Promise<void>;
        registerSettings?: (items: Record<string, unknown>) => Promise<void>;
    };
    versionInfo?: () => Promise<{ platform?: string }>;
};

// Common
export const SETTING_DEBUG = 'mycalendar.debug';

// Calendar
export const SETTING_WEEK_START = 'mycalendar.weekStart';
export const SETTING_SHOW_WEEK_NUMBERS = 'mycalendar.showWeekNumbers';

// UI
// Persists calendar panel visibility between app launches so that menu/toolbar toggle
// works correctly even when the panel was closed before quitting Joplin.
export const SETTING_PANEL_VISIBLE = 'mycalendar.panelVisible';

// Day events
export const SETTING_DAY_EVENTS_VIEW_MODE = 'mycalendar.dayEventsViewMode';
export const SETTING_TIME_FORMAT = 'mycalendar.timeFormat';
export const SETTING_DAY_EVENTS_REFRESH_MINUTES = 'mycalendar.dayEventsRefreshMinutes';
export const SETTING_SHOW_EVENT_TIMELINE = 'mycalendar.showEventTimeline';
export const SETTING_TIMELINE_NOW_LINE_COLOR_LIGHT = 'mycalendar.timelineNowLineColorLight';
export const SETTING_TIMELINE_NOW_LINE_COLOR_DARK = 'mycalendar.timelineNowLineColorDark';
export const SETTING_DEFAULT_EVENT_COLOR_LIGHT = 'mycalendar.defaultEventColorLight';
export const SETTING_DEFAULT_EVENT_COLOR_DARK = 'mycalendar.defaultEventColorDark';

// ICS Import
export const SETTING_ICS_IMPORT_ALARMS_ENABLED = 'mycalendar.icsImportAlarmsEnabled';
export const SETTING_ICS_IMPORT_ALARM_RANGE_DAYS = 'mycalendar.icsImportAlarmRangeDays';
export const SETTING_ICS_IMPORT_ALARM_EMOJI = 'mycalendar.icsImportAlarmEmoji';
export const SETTING_ICS_SCHEDULED_IMPORT_PAIRS = 'mycalendar.icsScheduledImportPairs';
export const SETTING_ICS_SCHEDULED_IMPORT_INTERVAL_MINUTES = 'mycalendar.icsScheduledImportIntervalMinutes';

// Export links
export const SETTING_ICS_EXPORT_LINK_PAIRS = 'mycalendar.icsExportLinkPairs';

// Legacy multi-link settings. Kept as hidden fallback for existing installs.
export const SETTING_ICS_EXPORT_LINK1_TITLE = 'mycalendar.icsExportLink1Title';
export const SETTING_ICS_EXPORT_LINK1_URL = 'mycalendar.icsExportLink1Url';
export const SETTING_ICS_EXPORT_LINK2_TITLE = 'mycalendar.icsExportLink2Title';
export const SETTING_ICS_EXPORT_LINK2_URL = 'mycalendar.icsExportLink2Url';
export const SETTING_ICS_EXPORT_LINK3_TITLE = 'mycalendar.icsExportLink3Title';
export const SETTING_ICS_EXPORT_LINK3_URL = 'mycalendar.icsExportLink3Url';
export const SETTING_ICS_EXPORT_LINK4_TITLE = 'mycalendar.icsExportLink4Title';
export const SETTING_ICS_EXPORT_LINK4_URL = 'mycalendar.icsExportLink4Url';


export type WeekStart = 'monday' | 'sunday';
export type TimeFormat = '12h' | '24h';
export type DayEventsViewMode = 'single' | 'grouped';

export type IcsExportLink = {
    title: string;
    url: string;
};

export type ScheduledIcsImportEntry = {
    url: string;
    notebookTitle: string;
};

const TITLE_MAX_LEN = 60;
const ALARM_EMOJI_DEFAULT = '🔔';
const ALARM_EMOJI_MAX_LEN = 16;

// Avoid magic numbers for setting item types (Joplin: int=1, string=2, bool=3)
const SETTING_TYPE_INT = 1;
const SETTING_TYPE_STRING = 2;
const SETTING_TYPE_BOOL = 3;

const ICS_EXPORT_LINK_PAIRS: Array<{ titleKey: string; urlKey: string }> = [
    {titleKey: SETTING_ICS_EXPORT_LINK1_TITLE, urlKey: SETTING_ICS_EXPORT_LINK1_URL},
    {titleKey: SETTING_ICS_EXPORT_LINK2_TITLE, urlKey: SETTING_ICS_EXPORT_LINK2_URL},
    {titleKey: SETTING_ICS_EXPORT_LINK3_TITLE, urlKey: SETTING_ICS_EXPORT_LINK3_URL},
    {titleKey: SETTING_ICS_EXPORT_LINK4_TITLE, urlKey: SETTING_ICS_EXPORT_LINK4_URL},
];

const ICS_EXPORT_URL_KEYS = ICS_EXPORT_LINK_PAIRS.map(p => p.urlKey);
const ICS_EXPORT_TITLE_KEYS = ICS_EXPORT_LINK_PAIRS.map(p => p.titleKey);
const SCHEDULED_ICS_IMPORT_MINUTES_DEFAULT = 60;
const SCHEDULED_ICS_IMPORT_MINUTES_MIN = 5;
const SCHEDULED_ICS_IMPORT_MINUTES_MAX = 24 * 60;
const DEFAULT_EVENT_COLOR_LIGHT = '#e65100';
const DEFAULT_EVENT_COLOR_DARK = '#00e5e5';
const DEFAULT_TIMELINE_NOW_LINE_COLOR_LIGHT = '#e65100';
const DEFAULT_TIMELINE_NOW_LINE_COLOR_DARK = '#00e5e5';

export const SCHEDULED_ICS_IMPORT_SETTING_KEYS = [
    SETTING_ICS_SCHEDULED_IMPORT_PAIRS,
    SETTING_ICS_SCHEDULED_IMPORT_INTERVAL_MINUTES,
    SETTING_ICS_IMPORT_ALARMS_ENABLED,
    SETTING_ICS_IMPORT_ALARM_RANGE_DAYS,
    SETTING_ICS_IMPORT_ALARM_EMOJI,
] as const;

function replaceControlCharacters(input: unknown): string {
    let output = '';
    for (const character of String(input ?? '')) {
        const code = character.charCodeAt(0);
        output += (code <= 0x1f || code === 0x7f) ? ' ' : character;
    }
    return output;
}

export function sanitizeExternalUrl(input: unknown): string {
    const s = String(input ?? '').trim();
    if (!s) return '';

    try {
        const u = new URL(s);
        // Allow only http(s) links to avoid `javascript:`, `file:`, etc.
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
        return u.toString();
    } catch {
        return '';
    }
}

export function sanitizeSecureExternalUrl(input: unknown): string {
    const safe = sanitizeExternalUrl(input);
    if (!safe) return '';

    try {
        const u = new URL(safe);
        return u.protocol === 'https:' ? u.toString() : '';
    } catch {
        return '';
    }
}

export function sanitizeNotebookTitle(input: unknown): string {
    return replaceControlCharacters(input).trim();
}

export function sanitizeAlarmEmoji(input: unknown): string {
    const compact = replaceControlCharacters(input).replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > ALARM_EMOJI_MAX_LEN ? compact.slice(0, ALARM_EMOJI_MAX_LEN) : compact;
}

export function parseScheduledIcsImportEntries(input: unknown): ScheduledIcsImportEntry[] {
    const raw = String(input ?? '');
    const seen = new Set<string>();
    const out: ScheduledIcsImportEntry[] = [];

    const normalized = raw.replace(/\r?\n/g, ' ;; ');

    for (const line of normalized.split(';;')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const separatorIndex = trimmed.indexOf('|');
        if (separatorIndex < 0) continue;

        const url = sanitizeSecureExternalUrl(trimmed.slice(0, separatorIndex));
        const notebookTitle = sanitizeNotebookTitle(trimmed.slice(separatorIndex + 1));
        if (!url || !notebookTitle) continue;

        const dedupeKey = `${url}\n${notebookTitle}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({url, notebookTitle});
    }

    return out;
}

export function sanitizeScheduledIcsImportEntries(input: unknown): string {
    return parseScheduledIcsImportEntries(input)
        .map(({url, notebookTitle}) => `${url} | ${notebookTitle}`)
        .join(' ;; ');
}

export function parseIcsExportLinks(input: unknown): IcsExportLink[] {
    const raw = String(input ?? '');
    const seen = new Set<string>();
    const out: IcsExportLink[] = [];

    const normalized = raw.replace(/\r?\n/g, ' ;; ');

    for (const line of normalized.split(';;')) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const separatorIndex = trimmed.indexOf('|');
        if (separatorIndex < 0) continue;

        const title = sanitizeTitle(trimmed.slice(0, separatorIndex));
        const url = sanitizeExternalUrl(trimmed.slice(separatorIndex + 1));
        if (!url) continue;

        const dedupeKey = `${title}\n${url}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
        out.push({title, url});
    }

    return out;
}

export function sanitizeIcsExportLinks(input: unknown): string {
    return parseIcsExportLinks(input)
        .map(({title, url}) => `${title} | ${url}`)
        .join(' ;; ');
}

export function sanitizeTitle(input: unknown): string {
    const s = String(input ?? '').trim();
    // Keep it short to avoid breaking the layout.
    if (!s) return '';
    return s.length > TITLE_MAX_LEN ? s.slice(0, TITLE_MAX_LEN) : s;
}

export function sanitizeHexColor(input: unknown): string {
    return normalizeHexColor(input, {allowShort: true});
}

async function isMobile(joplin: SettingsRegistrar): Promise<boolean> {
    try {
        if (typeof joplin.versionInfo !== 'function') return false;
        const version = await joplin.versionInfo();
        return version?.platform === 'mobile';
    } catch {
        return false; // if the API is old/not available - consider desktop
    }
}

export async function registerSettings(joplin: SettingsRegistrar): Promise<void> {
    if (!joplin?.settings?.registerSection || !joplin?.settings?.registerSettings) return;

    // ---- Calendar ----------------------------------------------------------
    await joplin.settings.registerSection('mycalendar', {
        label: 'My Calendar',
        iconName: 'fas fa-calendar',
    });

    const mobile = await isMobile(joplin);

    await joplin.settings.registerSettings({
        // 1) Calendar
        // 2) Week starts on
        [SETTING_WEEK_START]: {
            value: 'monday',
            type: SETTING_TYPE_STRING, // string
            section: 'mycalendar',
            public: true,
            label: 'Week starts on',
            description: 'Calendar section: First day of week in calendar grid. Monday or Sunday. Monday as default.',
            isEnum: true,
            options: {
                monday: 'Monday',
                sunday: 'Sunday',
            },
        },

        [SETTING_SHOW_WEEK_NUMBERS]: {
            value: false,
            type: SETTING_TYPE_BOOL,
            section: 'mycalendar',
            public: true,
            label: 'Show week numbers',
            description: 'Calendar section: Show week numbers in the calendar grid.',
        },

        // Hidden internal setting: remembers whether the calendar panel was visible
        // the last time the user toggled it (menu/toolbar), so the first menu toggle
        // after restart opens it correctly.
        [SETTING_PANEL_VISIBLE]: {
            value: true,
            type: SETTING_TYPE_BOOL,
            section: 'mycalendar',
            public: false,
            label: 'Persist calendar panel visibility',
            description: 'Internal. Stores whether the My Calendar panel is visible.',
        },

        // 4) Day events
        [SETTING_DAY_EVENTS_VIEW_MODE]: {
            value: 'single',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Day events view mode',
            description: 'Day events section: Show events in a single list or grouped by ongoing/feature/past.',
            isEnum: true,
            options: {
                single: 'Single list',
                grouped: 'Grouped (ongoing/feature/past)',
            },
        },
        [SETTING_TIME_FORMAT]: {
            value: '24h',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Time format',
            description: 'Day events section: Choose between 12-hour (AM/PM) or 24-hour format for event times.',
            isEnum: true,
            options: {
                '12h': '12-hour (AM/PM)',
                '24h': '24-hour',
            },
        },
        // 5) Day events auto-refresh (minutes)
        [SETTING_DAY_EVENTS_REFRESH_MINUTES]: {
            value: 1,
            type: SETTING_TYPE_INT, // int
            section: 'mycalendar',
            public: true,
            label: 'Day events auto-refresh (minutes)',
            description: 'Day events section: How often the list refreshes.',
        },
        [SETTING_SHOW_EVENT_TIMELINE]: {
            value: true,
            type: SETTING_TYPE_BOOL, // bool
            section: 'mycalendar',
            public: true,
            label: 'Show event timeline',
            description: 'Day events section: Show a visual timeline bar under each event in the day list. Disabling this also stops related UI update timers (now dot / past status refresh).',
        },
        [SETTING_DEFAULT_EVENT_COLOR_LIGHT]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Default event color - light mode (hex)',
            description: `Day events and import fallback: Optional default event hex color for light mode, for example ${DEFAULT_EVENT_COLOR_LIGHT}. Leave empty to use the built-in light-mode default.`,
        },
        [SETTING_DEFAULT_EVENT_COLOR_DARK]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Default event color - dark mode (hex)',
            description: `Day events and import fallback: Optional default event hex color for dark mode, for example ${DEFAULT_EVENT_COLOR_DARK}. Leave empty to use the built-in dark-mode default.`,
        },
        [SETTING_TIMELINE_NOW_LINE_COLOR_LIGHT]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Current timeline line color - light mode (hex)',
            description: `Day events section: Optional current-time timeline line hex color for light mode, for example ${DEFAULT_TIMELINE_NOW_LINE_COLOR_LIGHT}. Leave empty to use the built-in light-mode default.`,
        },
        [SETTING_TIMELINE_NOW_LINE_COLOR_DARK]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Current timeline line color - dark mode (hex)',
            description: `Day events section: Optional current-time timeline line hex color for dark mode, for example ${DEFAULT_TIMELINE_NOW_LINE_COLOR_DARK}. Leave empty to use the built-in dark-mode default.`,
        },

        // 7) ICS Import
        [SETTING_ICS_IMPORT_ALARMS_ENABLED]: {
            value: false,
            type: SETTING_TYPE_BOOL, // bool
            section: 'mycalendar',
            public: !mobile,
            label: 'Enable ICS import alarms',
            description: 'ICS import section: If enabled, alarms from ICS files will be imported as Todo notes. If disabled, existing alarms will be deleted on re-import.',
        },
        [SETTING_ICS_IMPORT_ALARM_RANGE_DAYS]: {
            value: 30,
            type: SETTING_TYPE_INT, // int
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS import alarm range (days)',
            description: 'ICS import section: Import events alarms from now up to N days ahead. Default 30. During reimport all alarms will regenerated.',
        },
        [SETTING_ICS_IMPORT_ALARM_EMOJI]: {
            value: ALARM_EMOJI_DEFAULT,
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS reminder emoji',
            description: 'ICS import section: Emoji or short prefix added to imported reminder note titles. Default: 🔔.',
        },
        [SETTING_ICS_SCHEDULED_IMPORT_PAIRS]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: !mobile,
            label: 'Scheduled ICS import pairs (Link & Notebook Title)',
            description: 'ICS import section: Use "https://...ics | Notebook Title ;; https://...ics | Another Notebook". Add as many valid pairs as needed. ";;" separates pairs, "|" separates URL and notebook title.',
        },
        [SETTING_ICS_SCHEDULED_IMPORT_INTERVAL_MINUTES]: {
            value: SCHEDULED_ICS_IMPORT_MINUTES_DEFAULT,
            type: SETTING_TYPE_INT,
            section: 'mycalendar',
            public: !mobile,
            label: 'Scheduled ICS import interval (minutes)',
            description: 'ICS import section: How often the plugin re-imports ICS URLs in the background. Allowed range: 5-1440 minutes.',
        },
        [SETTING_ICS_EXPORT_LINK_PAIRS]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link pairs (Button Title & Link)',
            description: 'ICS import section: Use "Button Title | https://... ;; Another Button | https://...". Add as many valid pairs as needed. ";;" separates buttons, "|" separates button title and URL.',
        },

        // Legacy hidden fallback settings for older installs
        [SETTING_ICS_EXPORT_LINK1_TITLE]: {
            value: '',
            type: SETTING_TYPE_STRING, // string
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 1 title',
            description: 'ICS import section: Optional title for export link #1 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK1_URL]: {
            value: '',
            type: SETTING_TYPE_STRING, // string
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 1 URL',
            description: 'ICS import section: Optional URL for export link #1 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK2_TITLE]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 2 title',
            description: 'ICS import section: Optional title for export link #2 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK2_URL]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 2 URL',
            description: 'ICS import section: Optional URL for export link #2 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK3_TITLE]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 3 title',
            description: 'ICS import section: Optional title for export link #3 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK3_URL]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 3 URL',
            description: 'ICS import section: Optional URL for export link #3 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK4_TITLE]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 4 title',
            description: 'ICS import section: Optional title for export link #4 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK4_URL]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: false,
            label: 'ICS export link 4 URL',
            description: 'ICS import section: Optional URL for export link #4 (http/https only).',
        },

        // 10) Developer
        // 11) Enable debug logging
        [SETTING_DEBUG]: {
            value: false,
            type: SETTING_TYPE_BOOL, // bool
            section: 'mycalendar',
            public: true,
            label: 'Enable debug logging',
            description: 'Enable visible in the interface extra logging to help debugging.',
        },
    });


    // Keep stored URLs safe even if user pastes `javascript:` etc.
    if (typeof joplin?.settings?.onChange === 'function' && typeof joplin?.settings?.setValue === 'function') {
        const setSettingValue = joplin.settings.setValue;
        await joplin.settings.onChange(async (event: SettingsChangeEvent) => {
            try {
                const keys: string[] = event?.keys || [];

                const normalizeStoredSetting = async (
                    key: string,
                    normalize: (value: unknown) => unknown,
                ): Promise<void> => {
                    const raw = await joplin.settings.value(key);
                    const normalized = normalize(raw);
                    if (raw !== normalized) await setSettingValue(key, normalized);
                };

                const normalizeAlarmEmoji = (value: unknown): string =>
                    sanitizeAlarmEmoji(value) || ALARM_EMOJI_DEFAULT;

                const touchedUrl = ICS_EXPORT_URL_KEYS.some((k) => keys.includes(k));
                const touchedTitle = ICS_EXPORT_TITLE_KEYS.some((k) => keys.includes(k));
                const touchedExportPairs = keys.includes(SETTING_ICS_EXPORT_LINK_PAIRS);
                const touchedScheduledImportPairs = keys.includes(SETTING_ICS_SCHEDULED_IMPORT_PAIRS);
                const touchedDefaultEventColor = [
                    SETTING_DEFAULT_EVENT_COLOR_LIGHT,
                    SETTING_DEFAULT_EVENT_COLOR_DARK,
                ].some((k) => keys.includes(k));
                const touchedTimelineNowLineColor = [
                    SETTING_TIMELINE_NOW_LINE_COLOR_LIGHT,
                    SETTING_TIMELINE_NOW_LINE_COLOR_DARK,
                ].some((k) => keys.includes(k));
                const touchedAlarmEmoji = keys.includes(SETTING_ICS_IMPORT_ALARM_EMOJI);
                const touchedDebug = keys.includes(SETTING_DEBUG);
                if (!touchedUrl && !touchedTitle && !touchedExportPairs && !touchedScheduledImportPairs && !touchedDefaultEventColor && !touchedTimelineNowLineColor && !touchedAlarmEmoji && !touchedDebug) return;
                for (const k of ICS_EXPORT_URL_KEYS) {
                    if (keys.includes(k)) await normalizeStoredSetting(k, sanitizeExternalUrl);
                }
                for (const k of ICS_EXPORT_TITLE_KEYS) {
                    if (keys.includes(k)) await normalizeStoredSetting(k, sanitizeTitle);
                }
                if (touchedExportPairs) {
                    await normalizeStoredSetting(SETTING_ICS_EXPORT_LINK_PAIRS, sanitizeIcsExportLinks);
                }
                if (touchedScheduledImportPairs) {
                    await normalizeStoredSetting(SETTING_ICS_SCHEDULED_IMPORT_PAIRS, sanitizeScheduledIcsImportEntries);
                }
                if (touchedDefaultEventColor) {
                    for (const key of [
                        SETTING_DEFAULT_EVENT_COLOR_LIGHT,
                        SETTING_DEFAULT_EVENT_COLOR_DARK,
                    ]) {
                        if (keys.includes(key)) await normalizeStoredSetting(key, sanitizeHexColor);
                    }
                }
                if (touchedTimelineNowLineColor) {
                    for (const key of [
                        SETTING_TIMELINE_NOW_LINE_COLOR_LIGHT,
                        SETTING_TIMELINE_NOW_LINE_COLOR_DARK,
                    ]) {
                        if (keys.includes(key)) await normalizeStoredSetting(key, sanitizeHexColor);
                    }
                }
                if (touchedAlarmEmoji) {
                    await normalizeStoredSetting(SETTING_ICS_IMPORT_ALARM_EMOJI, normalizeAlarmEmoji);
                }
                if (touchedDebug) {
                    const v = await joplin.settings.value(SETTING_DEBUG);
                    setDebugEnabled(!!v);
                }
            } catch {
                // ignore
            }
        });
    }

    const v = await joplin.settings.value(SETTING_DEBUG);
    setDebugEnabled(!!v);
}

// Common
export async function getDebugEnabled(joplin: SettingsReader): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_DEBUG));
}

// Calendar
export async function getWeekStart(joplin: SettingsReader): Promise<WeekStart> {
    const raw = await joplin.settings.value(SETTING_WEEK_START);
    const v = String(raw ?? '').toLowerCase().trim();
    return (v === 'sunday' || v === 'monday') ? (v as WeekStart) : 'monday';
}

export async function getShowWeekNumbers(joplin: SettingsReader): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_SHOW_WEEK_NUMBERS));
}

// Day events
export async function getShowEventTimeline(joplin: SettingsReader): Promise<boolean> {
    const raw = await joplin.settings.value(SETTING_SHOW_EVENT_TIMELINE);
    // Default should be true even if the setting is missing/undefined (older installs / migrations)
    if (raw === null || raw === undefined) return true;
    return Boolean(raw);
}

export async function getTimelineNowLineColor(joplin: SettingsReader): Promise<string> {
    return getTimelineNowLineColorLight(joplin);
}

async function getThemeColorSetting(joplin: SettingsReader, key: string, builtInDefault: string): Promise<string> {
    const raw = await joplin.settings.value(key);
    const color = sanitizeHexColor(raw);
    return color || builtInDefault;
}

export async function getTimelineNowLineColorLight(joplin: SettingsReader): Promise<string> {
    return getThemeColorSetting(
        joplin,
        SETTING_TIMELINE_NOW_LINE_COLOR_LIGHT,
        DEFAULT_TIMELINE_NOW_LINE_COLOR_LIGHT,
    );
}

export async function getTimelineNowLineColorDark(joplin: SettingsReader): Promise<string> {
    return getThemeColorSetting(
        joplin,
        SETTING_TIMELINE_NOW_LINE_COLOR_DARK,
        DEFAULT_TIMELINE_NOW_LINE_COLOR_DARK,
    );
}

export async function getDefaultEventColor(joplin: SettingsReader): Promise<string> {
    return getDefaultEventColorLight(joplin);
}

export async function getDefaultEventColorLight(joplin: SettingsReader): Promise<string> {
    return getThemeColorSetting(
        joplin,
        SETTING_DEFAULT_EVENT_COLOR_LIGHT,
        DEFAULT_EVENT_COLOR_LIGHT,
    );
}

export async function getDefaultEventColorDark(joplin: SettingsReader): Promise<string> {
    return getThemeColorSetting(
        joplin,
        SETTING_DEFAULT_EVENT_COLOR_DARK,
        DEFAULT_EVENT_COLOR_DARK,
    );
}

export async function getDayEventsRefreshMinutes(joplin: SettingsReader): Promise<number> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_REFRESH_MINUTES);
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(60, Math.max(1, Math.round(n)));
}

export async function getTimeFormat(joplin: SettingsReader): Promise<TimeFormat> {
    const raw = await joplin.settings.value(SETTING_TIME_FORMAT);
    return (raw === '12h' || raw === '24h') ? raw : '24h';
}

export async function getDayEventsViewMode(joplin: SettingsReader): Promise<DayEventsViewMode> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_VIEW_MODE);
    return raw === 'grouped' ? 'grouped' : 'single';
}

// ICS import
export async function getIcsImportAlarmsEnabled(joplin: SettingsReader): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_ICS_IMPORT_ALARMS_ENABLED));
}

export async function getIcsImportAlarmRangeDays(joplin: SettingsReader): Promise<number> {
    const raw = await joplin.settings.value(SETTING_ICS_IMPORT_ALARM_RANGE_DAYS);
    if (raw === null || raw === undefined) {
        return 30;
    }
    const n = Number(raw);
    if (!Number.isFinite(n)) {
        return 30;
    }
    // Guardrails: keep the import range reasonable.
    // If user entered 0, we clamp to 1.
    return Math.min(365, Math.max(1, Math.round(n)));
}

export async function getIcsImportAlarmEmoji(joplin: SettingsReader): Promise<string> {
    const raw = await joplin.settings.value(SETTING_ICS_IMPORT_ALARM_EMOJI);
    return sanitizeAlarmEmoji(raw) || ALARM_EMOJI_DEFAULT;
}

export async function getScheduledIcsImportIntervalMinutes(joplin: SettingsReader): Promise<number> {
    const raw = await joplin.settings.value(SETTING_ICS_SCHEDULED_IMPORT_INTERVAL_MINUTES);
    if (raw === null || raw === undefined) return SCHEDULED_ICS_IMPORT_MINUTES_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SCHEDULED_ICS_IMPORT_MINUTES_DEFAULT;
    return Math.min(SCHEDULED_ICS_IMPORT_MINUTES_MAX, Math.max(SCHEDULED_ICS_IMPORT_MINUTES_MIN, Math.round(n)));
}

export async function getScheduledIcsImportEntries(joplin: SettingsReader): Promise<ScheduledIcsImportEntry[]> {
    const raw = await joplin.settings.value(SETTING_ICS_SCHEDULED_IMPORT_PAIRS);
    return parseScheduledIcsImportEntries(raw);
}

export async function getIcsExportLinks(joplin: SettingsReader): Promise<IcsExportLink[]> {
    const pairsRaw = await joplin.settings.value(SETTING_ICS_EXPORT_LINK_PAIRS);
    const parsedPairs = parseIcsExportLinks(pairsRaw);
    if (parsedPairs.length > 0) {
        return parsedPairs;
    }

    const out: IcsExportLink[] = [];

    for (const p of ICS_EXPORT_LINK_PAIRS) {
        const rawTitle = await joplin.settings.value(p.titleKey);
        const rawUrl = await joplin.settings.value(p.urlKey);

        const title = sanitizeTitle(rawTitle);
        const url = sanitizeExternalUrl(rawUrl);

        if (!url) continue;
        out.push({title, url});
    }

    return out;
}
