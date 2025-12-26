import joplin from 'api';

// src/calendarView.ts
export async function createCalendarPanel(joplin: any): Promise<string> {
    const panelId = await joplin.views.panels.create('mycalendarPanel');

    await joplin.views.panels.setHtml(panelId, `
  <div id="cal-root">
    <div id="mc-toolbar"></div>
    <!-- КАЛЕНДАР -->
    <div id="mc-grid"></div>
    <!-- ПОДІЇ ДНЯ -->
    <div id="mc-events">
      <div class="mc-events-header">Today events</div>
      <ul id="mc-events-list"></ul>
    </div>
    <!-- ІМПОРТ (ОКРЕМИЙ БЛОК ВНИЗУ) -->
    <div id="mc-import">
      <div class="mc-import-header">ICS import</div>
      <div id="mc-import-body">
        <div id="ical-root"></div>
      </div>
    </div>
    <!-- LOG -->
    <div id="mc-log"></div>
  </div>
`);


    await joplin.views.panels.addScript(panelId, './ui/calendar.css');
    await joplin.views.panels.addScript(panelId, './ui/calendar.js');
    await joplin.views.panels.addScript(panelId, './ui/icalImport.js');
    await joplin.views.panels.show(panelId);
    console.log('[MyCalendar] calendarView created');

    return panelId;
}

