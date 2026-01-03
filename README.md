# Attention!!! Under development, under usability testing.

# 🗓️ joplin-plugin-my-calendar

The [Joplin](https://joplinapp.org/) plugin provides the ability to:

- Use notes as calendar events;
- Display notes as events in the monthly calendar section;
- Import the contents of an *.ics file into notes as calendar events in a previously specified notebook (
  Desktop [Joplin](https://joplinapp.org/) only).

| N | Feature          | Desktop Joplin | Mobile Joplin |
|---|------------------|----------------|---------------|
| 1 | Monthly calendar | +              | +             |
| 2 | Day events       | +              | +             |
| 3 | *.ics import     | +              | -             |

---

## Features

### 1) Monthly calendar

- Navigation:
    - previous month,
    - current month,
    - next month buttons,
    - selected month name and year label;
- A grid with all numbered days of the current/selected month;
- Colored event bar(s) inside the day tail;

### 2) Current/Selected day events

- Month and day number label;
- Events list with details like:
    - color,
    - title, is clickable,
    - time;

### 3) ICS import section

Import behavior: each event from ics file is unique by uid, first import note as event will be created, second import
each not will be updated or ignored, depends on all ics event properties.

- Form for ICS file import:
    - Target notebook select box and reload list button;
    - ICS File picker and import button;
  - Options related to the event color;

---

## Syntax and properties supported by the calendar

~~~
```mycalendar-event
title: The name of the event
start: 2025-08-12 10:00:00-04:00
end: 2025-08-12 12:00:00-04:00
tz: America/Toronto
color: #ff8800
location: random string with location
description: Description of the event

repeat: daily|weekly|monthly|yearly
repeat_interval: 1
repeat_until: 2025-12-31 23:59:59-04:00
byweekday: MO,TU,WE,TH,FR     # weekly
bymonthday: 12                # monthly
uid: <unique ical id>         # string for event, more important for mass import from ical. Not required for manually created note (as a calendar event).
recurrence_id: <RECURRENCE-ID>
all_day: true
```
~~~

## start,end and tz variations:

1) This time will be converted to current device timezone.
```
start: 2025-12-18 08:00:00
end:   2025-12-18 09:00:00
tz: America/Toronto
```

2) This time will be converted to current device timezone.
```
start: 2025-12-18 08:00:00-05:00
end:   2025-12-18 09:00:00-05:00
```

3) This time will be shown in current device timezone without timezone conversion.
```
start: 2025-12-18 08:00:00
end:   2025-12-18 09:00:00
```

---

## Development

### Build

`npm run pack;`

### Security

- `npm audit;npm audit fix;`
- need to find more tools for security scanning;

### Testing

- Tested manually with [Joplin](https://joplinapp.org/) Desktop (Ubuntu 24 release);
- Tested manually with [Joplin](https://joplinapp.org/) Android;
- Covered by automated testing, commands:
  - `npx jest --runInBand --no-cache;`;
    - `npm test;`;

### File structure

- See: [directory-tree.txt](directory-tree.txt)

### Todo

- See [list.todo](list.todo);
- In the code;

---

## License

- [LICENSE](LICENSE)





