# Daily Recurrence with an End Date and Exceptions

This reminder appears every second day, stops on the configured end date, and skips two specific occurrences.

```mycalendar-event
title: Practice French
start: 2026-08-12 18:30
end: 2026-08-12 19:00
tz: America/Toronto
repeat: daily
repeat_interval: 2
repeat_until: 2026-09-11
exdate: 2026-08-18 18:30
exdate: 2026-08-26 18:30
color: #1abc9c
```

`repeat_until` with a date only includes that whole day. Add one `exdate` line for each occurrence that should be
omitted.
