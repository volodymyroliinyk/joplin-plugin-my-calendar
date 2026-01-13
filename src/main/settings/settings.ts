// src/main/settings/settings.ts

// import joplin from 'api';
import {setDebugEnabled} from '../utils/logger';

export const SETTING_DEBUG = 'mycalendar.debug';
export const SETTING_WEEK_START = 'mycalendar.weekStart';
export const SETTING_ICS_EXPORT_URL = 'mycalendar.icsExportUrl';
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

export async function registerSettings(joplin: any) {
    if (!joplin?.settings?.registerSection || !joplin?.settings?.registerSettings) return;
    await joplin.settings.registerSection('mycalendar', {
        label: 'My Calendar',
        iconName: 'fas fa-calendar',
    });

    await joplin.settings.registerSettings({
        [SETTING_DEBUG]: {
            value: false,
            type: 3, // for debug
            section: 'mycalendar',
            public: true,
            label: 'Enable debug logging',
        },
        [SETTING_WEEK_START]: {
            value: 'monday',
            type: 2, // for weekStart
            section: 'mycalendar',
            public: true,
            label: 'Week starts on',
            description: 'First day of week in calendar grid.',
            isEnum: true,
            options: {
                monday: 'Monday',
                sunday: 'Sunday',
            },
        },
        [SETTING_ICS_EXPORT_URL]: {
            value: '',
            type: 2, // string
            section: 'mycalendar',
            public: true,
            label: 'ICS export page URL',
            description: 'Optional link to your calendar provider export page (http/https only).',
        },
    });

    // Keep stored URL safe (e.g. block `javascript:`) even if user pastes it.
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
