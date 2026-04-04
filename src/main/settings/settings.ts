// src/main/settings/settings.ts

import {setDebugEnabled} from '../utils/logger';

// Common
export const SETTING_DEBUG = 'mycalendar.debug';

// Calendar
export const SETTING_WEEK_START = 'mycalendar.weekStart';
export const SETTING_SHOW_WEEK_NUMBERS = 'mycalendar.showWeekNumbers';

// Day events
export const SETTING_DAY_EVENTS_VIEW_MODE = 'mycalendar.dayEventsViewMode';
export const SETTING_TIME_FORMAT = 'mycalendar.timeFormat';
export const SETTING_DAY_EVENTS_REFRESH_MINUTES = 'mycalendar.dayEventsRefreshMinutes';
export const SETTING_SHOW_EVENT_TIMELINE = 'mycalendar.showEventTimeline';
export const SETTING_TIMELINE_NOW_LINE_COLOR = 'mycalendar.timelineNowLineColor';
export const SETTING_IMPORT_DEFAULT_EVENT_COLOR = 'mycalendar.importDefaultEventColor';

// ICS Import
export const SETTING_ICS_IMPORT_ALARMS_ENABLED = 'mycalendar.icsImportAlarmsEnabled';
export const SETTING_ICS_IMPORT_ALARM_RANGE_DAYS = 'mycalendar.icsImportAlarmRangeDays';
export const SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER = 'mycalendar.icsImportEmptyTrashAfter';
export const SETTING_ICS_IMPORT_ALARM_EMOJI = 'mycalendar.icsImportAlarmEmoji';
export const SETTING_ICS_AUTO_IMPORT_PAIRS = 'mycalendar.icsAutoImportPairs';
export const SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES = 'mycalendar.icsAutoImportIntervalMinutes';

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

export type AutomatedIcsImportEntry = {
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
const AUTOMATED_ICS_IMPORT_MINUTES_DEFAULT = 60;
const AUTOMATED_ICS_IMPORT_MINUTES_MIN = 5;
const AUTOMATED_ICS_IMPORT_MINUTES_MAX = 24 * 60;

export const AUTOMATED_ICS_IMPORT_SETTING_KEYS = [
    SETTING_ICS_AUTO_IMPORT_PAIRS,
    SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES,
    SETTING_ICS_IMPORT_ALARMS_ENABLED,
    SETTING_ICS_IMPORT_ALARM_RANGE_DAYS,
    SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER,
    SETTING_ICS_IMPORT_ALARM_EMOJI,
] as const;

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
    const text = String(input ?? '');
    let out = '';

    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += (code <= 0x1f || code === 0x7f) ? ' ' : ch;
    }

    return out.trim();
}

export function sanitizeAlarmEmoji(input: unknown): string {
    const text = String(input ?? '');
    let out = '';

    for (const ch of text) {
        const code = ch.charCodeAt(0);
        out += (code <= 0x1f || code === 0x7f) ? ' ' : ch;
    }

    const compact = out.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    return compact.length > ALARM_EMOJI_MAX_LEN ? compact.slice(0, ALARM_EMOJI_MAX_LEN) : compact;
}

export function parseAutomatedIcsImportEntries(input: unknown): AutomatedIcsImportEntry[] {
    const raw = String(input ?? '');
    const seen = new Set<string>();
    const out: AutomatedIcsImportEntry[] = [];

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

export function sanitizeAutomatedIcsImportEntries(input: unknown): string {
    return parseAutomatedIcsImportEntries(input)
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
    const s = String(input ?? '').trim();
    if (!s) return '';
    return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s) ? s : '';
}

async function isMobile(joplin: any): Promise<boolean> {
    try {
        const v = await joplin.versionInfo();
        return (v as any)?.platform === 'mobile';
    } catch {
        return false; // if the API is old/not available - consider desktop
    }
}

export async function registerSettings(joplin: any) {
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
        [SETTING_IMPORT_DEFAULT_EVENT_COLOR]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Default imported event color (hex)',
            description: 'ICS import section: Optional default hex color for imported events without X-COLOR, for example #1470d9. Leave empty to use the built-in default color.',
        },
        [SETTING_TIMELINE_NOW_LINE_COLOR]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: true,
            label: 'Current timeline line color (hex)',
            description: 'Day events section: Optional custom hex color for the current-time timeline line, for example #ffa334. Leave empty to use the default theme color.',
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
        [SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER]: {
            value: false,
            type: SETTING_TYPE_BOOL, // bool
            section: 'mycalendar',
            public: !mobile,
            label: 'Empty trash after alarm cleanup',
            description: 'ICS import section: If enabled, the plugin will empty the trash after deleting old alarms. WARNING: This deletes ALL items in the trash bin.',
        },
        [SETTING_ICS_IMPORT_ALARM_EMOJI]: {
            value: ALARM_EMOJI_DEFAULT,
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS reminder emoji',
            description: 'ICS import section: Emoji or short prefix added to imported reminder note titles. Default: 🔔.',
        },
        [SETTING_ICS_AUTO_IMPORT_PAIRS]: {
            value: '',
            type: SETTING_TYPE_STRING,
            section: 'mycalendar',
            public: !mobile,
            label: 'Automated ICS import pairs (Link & Notebook Title)',
            description: 'ICS import section: Use "https://...ics | Notebook Title ;; https://...ics | Another Notebook". Add as many valid pairs as needed. ";;" separates pairs, "|" separates URL and notebook title.',
        },
        [SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES]: {
            value: AUTOMATED_ICS_IMPORT_MINUTES_DEFAULT,
            type: SETTING_TYPE_INT,
            section: 'mycalendar',
            public: !mobile,
            label: 'Automated ICS import interval (minutes)',
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
        await joplin.settings.onChange(async (event: any) => {
            try {
                const keys: string[] = event?.keys || [];

                const maybeFixUrl = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeExternalUrl(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const maybeFixTitle = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeTitle(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const maybeFixAutomatedPairs = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeAutomatedIcsImportEntries(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const maybeFixHexColor = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeHexColor(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const maybeFixAlarmEmoji = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeAlarmEmoji(raw) || ALARM_EMOJI_DEFAULT;
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const maybeFixExportPairs = async (key: string) => {
                    const raw = await joplin.settings.value(key);
                    const safe = sanitizeIcsExportLinks(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const touchedUrl = ICS_EXPORT_URL_KEYS.some((k) => keys.includes(k));
                const touchedTitle = ICS_EXPORT_TITLE_KEYS.some((k) => keys.includes(k));
                const touchedExportPairs = keys.includes(SETTING_ICS_EXPORT_LINK_PAIRS);
                const touchedAutoImportPairs = keys.includes(SETTING_ICS_AUTO_IMPORT_PAIRS);
                const touchedImportDefaultEventColor = keys.includes(SETTING_IMPORT_DEFAULT_EVENT_COLOR);
                const touchedTimelineNowLineColor = keys.includes(SETTING_TIMELINE_NOW_LINE_COLOR);
                const touchedAlarmEmoji = keys.includes(SETTING_ICS_IMPORT_ALARM_EMOJI);
                const touchedDebug = keys.includes(SETTING_DEBUG);
                if (!touchedUrl && !touchedTitle && !touchedExportPairs && !touchedAutoImportPairs && !touchedImportDefaultEventColor && !touchedTimelineNowLineColor && !touchedAlarmEmoji && !touchedDebug) return;
                for (const k of ICS_EXPORT_URL_KEYS) {
                    if (keys.includes(k)) await maybeFixUrl(k);
                }
                for (const k of ICS_EXPORT_TITLE_KEYS) {
                    if (keys.includes(k)) await maybeFixTitle(k);
                }
                if (touchedExportPairs) {
                    await maybeFixExportPairs(SETTING_ICS_EXPORT_LINK_PAIRS);
                }
                if (touchedAutoImportPairs) {
                    await maybeFixAutomatedPairs(SETTING_ICS_AUTO_IMPORT_PAIRS);
                }
                if (touchedImportDefaultEventColor) {
                    await maybeFixHexColor(SETTING_IMPORT_DEFAULT_EVENT_COLOR);
                }
                if (touchedTimelineNowLineColor) {
                    await maybeFixHexColor(SETTING_TIMELINE_NOW_LINE_COLOR);
                }
                if (touchedAlarmEmoji) {
                    await maybeFixAlarmEmoji(SETTING_ICS_IMPORT_ALARM_EMOJI);
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
export async function getDebugEnabled(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_DEBUG));
}

// Calendar
export async function getWeekStart(joplin: any): Promise<WeekStart> {
    const raw = await joplin.settings.value(SETTING_WEEK_START);
    const v = String(raw ?? '').toLowerCase().trim();
    return (v === 'sunday' || v === 'monday') ? (v as WeekStart) : 'monday';
}

export async function getShowWeekNumbers(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_SHOW_WEEK_NUMBERS));
}

// Day events
export async function getShowEventTimeline(joplin: any): Promise<boolean> {
    const raw = await joplin.settings.value(SETTING_SHOW_EVENT_TIMELINE);
    // Default should be true even if the setting is missing/undefined (older installs / migrations)
    if (raw === null || raw === undefined) return true;
    return Boolean(raw);
}

export async function getTimelineNowLineColor(joplin: any): Promise<string> {
    const raw = await joplin.settings.value(SETTING_TIMELINE_NOW_LINE_COLOR);
    return sanitizeHexColor(raw);
}

export async function getImportDefaultEventColor(joplin: any): Promise<string> {
    const raw = await joplin.settings.value(SETTING_IMPORT_DEFAULT_EVENT_COLOR);
    return sanitizeHexColor(raw);
}

export async function getDayEventsRefreshMinutes(joplin: any): Promise<number> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_REFRESH_MINUTES);
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(60, Math.max(1, Math.round(n)));
}

export async function getTimeFormat(joplin: any): Promise<TimeFormat> {
    const raw = await joplin.settings.value(SETTING_TIME_FORMAT);
    return (raw === '12h' || raw === '24h') ? raw : '24h';
}

export async function getDayEventsViewMode(joplin: any): Promise<DayEventsViewMode> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_VIEW_MODE);
    return raw === 'grouped' ? 'grouped' : 'single';
}

// ICS import
export async function getIcsImportAlarmsEnabled(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_ICS_IMPORT_ALARMS_ENABLED));
}

export async function getIcsImportAlarmRangeDays(joplin: any): Promise<number> {
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

export async function getIcsImportEmptyTrashAfter(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER));
}

export async function getIcsImportAlarmEmoji(joplin: any): Promise<string> {
    const raw = await joplin.settings.value(SETTING_ICS_IMPORT_ALARM_EMOJI);
    return sanitizeAlarmEmoji(raw) || ALARM_EMOJI_DEFAULT;
}

export async function getAutomatedIcsImportIntervalMinutes(joplin: any): Promise<number> {
    const raw = await joplin.settings.value(SETTING_ICS_AUTO_IMPORT_INTERVAL_MINUTES);
    if (raw === null || raw === undefined) return AUTOMATED_ICS_IMPORT_MINUTES_DEFAULT;
    const n = Number(raw);
    if (!Number.isFinite(n)) return AUTOMATED_ICS_IMPORT_MINUTES_DEFAULT;
    return Math.min(AUTOMATED_ICS_IMPORT_MINUTES_MAX, Math.max(AUTOMATED_ICS_IMPORT_MINUTES_MIN, Math.round(n)));
}

export async function getAutomatedIcsImportEntries(joplin: any): Promise<AutomatedIcsImportEntry[]> {
    const raw = await joplin.settings.value(SETTING_ICS_AUTO_IMPORT_PAIRS);
    return parseAutomatedIcsImportEntries(raw);
}

export async function getIcsExportLinks(joplin: any): Promise<IcsExportLink[]> {
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
