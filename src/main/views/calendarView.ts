// src/main/views/calendarView.ts

import joplin from 'api';

export async function createCalendarPanel(joplin: any): Promise<string> {
    const panel = await joplin.views.panels.create('mycalendarPanel');

    await joplin.views.panels.setHtml(panel, `
  <div id="cal-root">
    <div id="mc-toolbar"></div>
    <!-- CALENDAR -->
    <div id="mc-grid"></div>
    <!-- EVENTS OF THE DAY -->
    <div id="mc-events">
      <div class="mc-events-header">
        <span>Day events</span>
        <span id="mc-events-day-label"></span>
       </div>
      <ul id="mc-events-list"></ul>
    </div>
    <!-- IMPORT (SEPARATE BLOCK BELOW) -->
    <div id="mc-import">
      <div class="mc-import-header">ICS import</div>
      <div id="mc-import-body">
        <div id="ics-root"></div>
      </div>
    </div>
    <!-- LOG -->
    <div id="mc-log"></div>
  </div>
`);


    await joplin.views.panels.addScript(panel, './ui/calendar.css');
    await joplin.views.panels.addScript(panel, './ui/calendar.js');
    await joplin.views.panels.addScript(panel, './ui/icsImport.js');
    await joplin.views.panels.show(panel);
    console.log('[MyCalendar] calendarView created');

    return panel;
}

