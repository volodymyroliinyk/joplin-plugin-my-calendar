# Timezone Handling Examples

Different ways to specify timezones for your events.

### 1. Using UTC Offset

```mycalendar-event
title: Global Sync (Offset)
start: 2026-07-25 15:00+00:00
```

### 2. Using IANA Timezone Name

```mycalendar-event
title: Board Meeting (London)
start: 2026-07-25 10:00
tz: Europe/London
```

### 3. Floating Local Time

```mycalendar-event
title: Morning Coffee (Local)
start: 2026-07-25 08:00
```
