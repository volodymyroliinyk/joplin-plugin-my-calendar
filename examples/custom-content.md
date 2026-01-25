# Custom Content Around Events

You can add any text, images, or Markdown formatting before and after the `mycalendar-event` block.

### Why this is useful:

If you are using the **ICS Import** feature, the plugin is smart enough to only update the content inside the code
block. Your personal notes, checklists, or comments outside the block will **remain untouched**.

### Example:

This is my personal introduction to this meeting. I can add a [link](https://joplinapp.org) here.

```mycalendar-event
title: Project Sync
start: 2025-01-25 14:00
end: 2025-01-25 15:00
color: #3498db
```

---

### Meeting Agenda (My Custom Text)

- [ ] Review last week's goals
- [ ] Discuss new features
- [ ] Set deadline for v1.0

> This entire section (and the intro above) will be preserved even if the event time changes in your source calendar and
> gets re-imported.
