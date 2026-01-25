// src/main/types/icsTypes.ts

export type IcsValarm = {
    trigger: string;              // e.g. -PT1H, -P1D, -P1W, or an absolute date-time
    related?: 'START' | 'END';     // TRIGGER;RELATED=START|END
    action?: string;              // DISPLAY / AUDIO / EMAIL / ...
    description?: string;
    summary?: string;
    repeat?: number;
    duration?: string;             // e.g. PT15M
};

export type IcsEvent = {
    uid?: string;
    recurrence_id?: string;

    // MyCalendar normalized fields (what we write into ```mycalendar-event``` blocks)
    title?: string;
    description?: string;
    location?: string;
    color?: string;

    start?: string; // "2025-08-12 10:00:00-04:00" or without offset (with tz)
    end?: string;
    tz?: string; // IANA tz, e.g. "America/Toronto"

    repeat?: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
    repeat_interval?: number;
    repeat_until?: string;
    byweekday?: string;   // "MO,TU,WE"
    bymonthday?: string;  // "12"

    all_day?: boolean;
    valarms?: IcsValarm[];
};
