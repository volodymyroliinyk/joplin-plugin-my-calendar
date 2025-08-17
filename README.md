# Attention!!! Under development, not working yet.

# MyCalendar (Joplin Plugin)

**Description here...**:

```

# Syntax of events in a note

Stood up in the text of the note-block note:

```event
calendar: my-calendar-plugin
title: The name of the event
start: 2025-08-12 10:00:00-04:00
end:   2025-08-12 12:00:00-04:00
tz:    America/Toronto
color: #ff8800
desc:  Description of the event

repeat: daily|weekly|monthly|yearly
repeat_interval: 1
repeat_until: 2025-12-31 23:59:59-04:00
byweekday: MO,TU,WE,TH,FR     # weekly
bymonthday: 12                # monthly

```

# Build

`npm run clean;npm install;npm run pack;tar tf mycalendar.jpl; cp mycalendar.jpl mycalendar.tar;`