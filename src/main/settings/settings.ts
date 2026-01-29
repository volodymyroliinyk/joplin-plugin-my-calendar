// src/main/settings/settings.ts

import {setDebugEnabled} from '../utils/logger';

export const SETTING_DEBUG = 'mycalendar.debug';
export const SETTING_WEEK_START = 'mycalendar.weekStart';

// New multi-link settings (up to 4). Titles are optional.
export const SETTING_ICS_EXPORT_LINK1_TITLE = 'mycalendar.icsExportLink1Title';
export const SETTING_ICS_EXPORT_LINK1_URL = 'mycalendar.icsExportLink1Url';
export const SETTING_ICS_EXPORT_LINK2_TITLE = 'mycalendar.icsExportLink2Title';
export const SETTING_ICS_EXPORT_LINK2_URL = 'mycalendar.icsExportLink2Url';
export const SETTING_ICS_EXPORT_LINK3_TITLE = 'mycalendar.icsExportLink3Title';
export const SETTING_ICS_EXPORT_LINK3_URL = 'mycalendar.icsExportLink3Url';
export const SETTING_ICS_EXPORT_LINK4_TITLE = 'mycalendar.icsExportLink4Title';
export const SETTING_ICS_EXPORT_LINK4_URL = 'mycalendar.icsExportLink4Url';
export const SETTING_DAY_EVENTS_REFRESH_MINUTES = 'mycalendar.dayEventsRefreshMinutes';
export const SETTING_ICS_IMPORT_ALARM_RANGE_DAYS = 'mycalendar.icsImportAlarmRangeDays';
export const SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER = 'mycalendar.icsImportEmptyTrashAfter';

export type WeekStart = 'monday' | 'sunday';

export type IcsExportLink = {
    title: string;
    url: string;
};

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

export function sanitizeTitle(input: unknown): string {
    const s = String(input ?? '').trim();
    // Keep it short to avoid breaking the layout.
    if (!s) return '';
    return s.length > 60 ? s.slice(0, 60) : s;
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
            type: 2, // string
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

        // 4) Day events
        // 5) Day events auto-refresh (minutes)
        [SETTING_DAY_EVENTS_REFRESH_MINUTES]: {
            value: 1,
            type: 1, // int
            section: 'mycalendar',
            public: true,
            label: 'Day events auto-refresh (minutes)',
            description: 'Day events section: How often the list refreshes.',
        },

        // 7) ICS Import

        [SETTING_ICS_IMPORT_ALARM_RANGE_DAYS]: {
            value: 30,
            type: 1, // int
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS import alarm range (days)',
            description: 'ICS import section: Import events alarms from now up to N days ahead. Default 30. During reimport all alarms will regenerated.',
        },
        [SETTING_ICS_IMPORT_EMPTY_TRASH_AFTER]: {
            value: false,
            type: 3, // bool
            section: 'mycalendar',
            public: !mobile,
            label: 'Empty trash after alarm cleanup',
            description: 'ICS import section: If enabled, the plugin will empty the trash after deleting old alarms. WARNING: This deletes ALL items in the trash.',
        },
        // 8) ICS export links (up to 4)
        [SETTING_ICS_EXPORT_LINK1_TITLE]: {
            value: '',
            type: 2, // string
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 1 title',
            description: 'ICS import section: Optional title for export link #1 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK1_URL]: {
            value: '',
            type: 2, // string
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 1 URL',
            description: 'ICS import section: Optional URL for export link #1 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK2_TITLE]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 2 title',
            description: 'ICS import section: Optional title for export link #2 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK2_URL]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 2 URL',
            description: 'ICS import section: Optional URL for export link #2 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK3_TITLE]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 3 title',
            description: 'ICS import section: Optional title for export link #3 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK3_URL]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 3 URL',
            description: 'ICS import section: Optional URL for export link #3 (http/https only).',
        },

        [SETTING_ICS_EXPORT_LINK4_TITLE]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 4 title',
            description: 'ICS import section: Optional title for export link #4 (shown on button).',
        },
        [SETTING_ICS_EXPORT_LINK4_URL]: {
            value: '',
            type: 2,
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export link 4 URL',
            description: 'ICS import section: Optional URL for export link #4 (http/https only).',
        },

        // 10) Developer
        // 11) Enable debug logging
        [SETTING_DEBUG]: {
            value: false,
            type: 3, // bool
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
                    const sanitizeTitle = (input: unknown): string => {
                        const s = String(input ?? '').trim();
                        if (!s) return '';
                        return s.length > 60 ? s.slice(0, 60) : s;
                    };
                    const safe = sanitizeTitle(raw);
                    if (raw !== safe) await joplin.settings.setValue(key, safe);
                };

                const urlKeys = [
                    SETTING_ICS_EXPORT_LINK1_URL,
                    SETTING_ICS_EXPORT_LINK2_URL,
                    SETTING_ICS_EXPORT_LINK3_URL,
                    SETTING_ICS_EXPORT_LINK4_URL,
                ];

                const titleKeys = [
                    SETTING_ICS_EXPORT_LINK1_TITLE,
                    SETTING_ICS_EXPORT_LINK2_TITLE,
                    SETTING_ICS_EXPORT_LINK3_TITLE,
                    SETTING_ICS_EXPORT_LINK4_TITLE,
                ];

                const touchedUrl = urlKeys.some((k) => keys.includes(k));
                const touchedTitle = titleKeys.some((k) => keys.includes(k));

                if (!touchedUrl && !touchedTitle) return;

                for (const k of urlKeys) {
                    if (keys.includes(k)) await maybeFixUrl(k);
                }
                for (const k of titleKeys) {
                    if (keys.includes(k)) await maybeFixTitle(k);
                }
            } catch {
                // ignore
            }
        });
    }

    const v = await joplin.settings.value(SETTING_DEBUG);
    setDebugEnabled(!!v);
}

export async function getWeekStart(joplin: any): Promise<WeekStart> {
    return (await joplin.settings.value(SETTING_WEEK_START)) as WeekStart;
}

export async function getDebugEnabled(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_DEBUG));
}

export async function getIcsExportLinks(joplin: any): Promise<IcsExportLink[]> {
    const pairs: Array<{ titleKey: string; urlKey: string }> = [
        {titleKey: SETTING_ICS_EXPORT_LINK1_TITLE, urlKey: SETTING_ICS_EXPORT_LINK1_URL},
        {titleKey: SETTING_ICS_EXPORT_LINK2_TITLE, urlKey: SETTING_ICS_EXPORT_LINK2_URL},
        {titleKey: SETTING_ICS_EXPORT_LINK3_TITLE, urlKey: SETTING_ICS_EXPORT_LINK3_URL},
        {titleKey: SETTING_ICS_EXPORT_LINK4_TITLE, urlKey: SETTING_ICS_EXPORT_LINK4_URL},
    ];

    const out: IcsExportLink[] = [];

    for (const p of pairs) {
        const rawTitle = await joplin.settings.value(p.titleKey);
        const rawUrl = await joplin.settings.value(p.urlKey);

        const title = sanitizeTitle(rawTitle);
        const url = sanitizeExternalUrl(rawUrl);

        if (!url) continue;
        out.push({title, url});
    }

    return out;
}

export async function getDayEventsRefreshMinutes(joplin: any): Promise<number> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_REFRESH_MINUTES);
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(60, Math.max(1, Math.round(n)));
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
