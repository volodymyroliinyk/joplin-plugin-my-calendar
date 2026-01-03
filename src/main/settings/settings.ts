// src/main/settings/settings.ts

// import joplin from 'api';
import {setDebugEnabled} from '../utils/logger';

export const SETTING_DEBUG = 'mycalendar.debug';
export const SETTING_WEEK_START = 'mycalendar.weekStart';
export type WeekStart = 'monday' | 'sunday';


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
    });

    const v = await joplin.settings.value(SETTING_DEBUG);
    setDebugEnabled(!!v);
}

export async function getWeekStart(joplin: any): Promise<WeekStart> {
    return (await joplin.settings.value(SETTING_WEEK_START)) as WeekStart;
}

export async function getDebugEnabled(joplin: any): Promise<boolean> {
    return !!(await joplin.settings.value(SETTING_DEBUG));
}
