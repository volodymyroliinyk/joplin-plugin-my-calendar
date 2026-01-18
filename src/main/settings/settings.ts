// src/main/settings/settings.ts

import {setDebugEnabled} from '../utils/logger';

export const SETTING_DEBUG = 'mycalendar.debug';
export const SETTING_WEEK_START = 'mycalendar.weekStart';
export const SETTING_ICS_EXPORT_URL = 'mycalendar.icsExportUrl';
export const SETTING_DAY_EVENTS_REFRESH_MINUTES = 'mycalendar.dayEventsRefreshMinutes';

export type WeekStart = 'monday' | 'sunday';

function sanitizeExternalUrl(input: unknown): string {
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

async function isMobile(joplin: any): Promise<boolean> {
    try {
        const v = await joplin.versionInfo();
        return (v as any)?.platform === 'mobile';
    } catch {
        return false; // якщо API старе/нема - вважаємо desktop
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
        // 8) ICS export page URL
        [SETTING_ICS_EXPORT_URL]: {
            value: '',
            type: 2, // string
            section: 'mycalendar',
            public: !mobile,
            label: 'ICS export page URL',
            description: 'ICS import section: Optional link to your one calendar provider export page (http/https only).',
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


    // Keep stored URL safe even if user pastes `javascript:` etc.
    if (typeof joplin?.settings?.onChange === 'function' && typeof joplin?.settings?.setValue === 'function') {
        await joplin.settings.onChange(async (event: any) => {
            try {
                const keys: string[] = event?.keys || [];
                if (!keys.includes(SETTING_ICS_EXPORT_URL)) return;

                const raw = await joplin.settings.value(SETTING_ICS_EXPORT_URL);
                const safe = sanitizeExternalUrl(raw);
                if (raw !== safe) {
                    await joplin.settings.setValue(SETTING_ICS_EXPORT_URL, safe);
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

export async function getIcsExportUrl(joplin: any): Promise<string> {
    const raw = await joplin.settings.value(SETTING_ICS_EXPORT_URL);
    return sanitizeExternalUrl(raw);
}

export async function getDayEventsRefreshMinutes(joplin: any): Promise<number> {
    const raw = await joplin.settings.value(SETTING_DAY_EVENTS_REFRESH_MINUTES);
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    return Math.min(60, Math.max(1, Math.round(n)));
}
