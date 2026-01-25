# Timezone Handling Examples

Different ways to specify timezones for your events.

### 1. Using UTC Offset

```mycalendar-event
title: Global Sync (Offset)
start: 2025-03-01 15:00+00:00
```

### 2. Using IANA Timezone Name

```mycalendar-event
title: Board Meeting (London)
start: 2025-03-01 10:00
tz: Europe/London
```

### 3. Floating Local Time

```mycalendar-event
title: Morning Coffee (Local)
start: 2025-03-01 08:00
```
