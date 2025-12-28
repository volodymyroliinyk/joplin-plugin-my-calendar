// src/main/settings/settings.ts

import joplin from 'api';
import {setDebugEnabled} from '../utils/logger';

export const SETTING_DEBUG = 'mycalendar.debug';

export async function registerSettings() {
    await joplin.settings.registerSection('mycalendar', {
        label: 'My Calendar',
        iconName: 'fas fa-calendar',
    });

    await joplin.settings.registerSettings({
        [SETTING_DEBUG]: {
            value: false,
            type: 3, // Bool
            section: 'mycalendar',
            public: true,
            label: 'Enable debug logging',
        },
    });

    const v = await joplin.settings.value(SETTING_DEBUG);
    setDebugEnabled(!!v);
}
