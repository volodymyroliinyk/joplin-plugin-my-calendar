# Attention!!! Under development, under usability testing.

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
location: rundom string with location
description:  Description of the event

repeat: daily|weekly|monthly|yearly
repeat_interval: 1
repeat_until: 2025-12-31 23:59:59-04:00
byweekday: MO,TU,WE,TH,FR     # weekly
bymonthday: 12                # monthly
uid: unique ical id for event, more important for mass import from ical. Not required for manualy created note (as calendar event). 
```

# Build

`npm run clean;npm install;npm run pack;tar tf mycalendar.jpl; cp mycalendar.jpl mycalendar.tar;`