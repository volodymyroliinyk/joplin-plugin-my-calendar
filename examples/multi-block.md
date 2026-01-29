# Multiple Events in One Note

You can have multiple `mycalendar-event` blocks in a single note. Each one will be rendered as a separate event on the
calendar.

### Morning Task
```mycalendar-event
title: Review Emails
start: 2025-01-20 09:00
end: 2025-01-20 10:00
color: #95a5a6
```

Any text between the blocks will be preserved.

### Afternoon Task
```mycalendar-event
title: Client Call
start: 2025-01-20 14:00
end: 2025-01-20 15:00
color: #e74c3c
```

This is useful for daily logs or grouping related tasks.
