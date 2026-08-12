# ICS-Imported Changed Occurrence with Alarms

This is how metadata managed by ICS import can look for one changed occurrence of a recurring event.

```mycalendar-event
title: Project Sync — Rescheduled
start: 2026-08-12 11:00
end: 2026-08-12 12:00
tz: America/Toronto
location: Conference Room C
description: This occurrence was moved from its regular time by the calendar organizer.

valarm: {"trigger":"-PT15M","related":"START","action":"DISPLAY","description":"Project Sync starts in 15 minutes"}
valarm: {"trigger":"-PT1H","related":"START","action":"DISPLAY"}

uid: project-sync-2026@example.com
recurrence_id: America/Toronto:20260812T100000
```

`uid`, `recurrence_id`, and `valarm` are normally written and maintained by ICS import rather than by hand.
