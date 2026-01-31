// src/main/views/calendarView.ts

import {log} from '../utils/logger';

export type PanelHandle = string;

export interface JoplinPanelsApi {
    create(id: string): Promise<PanelHandle>;

    setHtml(handle: PanelHandle, html: string): Promise<void>;

    addScript(handle: PanelHandle, scriptPath: string): Promise<void>;

    show(handle: PanelHandle): Promise<void>;
}

export interface JoplinLike {
    views: {
        panels: JoplinPanelsApi;
    };
}

export const CALENDAR_PANEL_ID = 'mycalendarPanel';

export const CALENDAR_PANEL_HTML = `
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
`;

export const CALENDAR_PANEL_SCRIPTS = [
    './ui/mycalendar.css',
    './ui/calendar.js',
    './ui/icsImport.js',
] as const;

export async function createCalendarPanel(joplin: JoplinLike): Promise<PanelHandle> {
    const {panels} = joplin.views;
    const panel = await panels.create(CALENDAR_PANEL_ID);

    await panels.setHtml(panel, CALENDAR_PANEL_HTML);

    for (const script of CALENDAR_PANEL_SCRIPTS) {
        await panels.addScript(panel, script);
    }

    await panels.show(panel);
    log('calendarView', 'Panel created');

    return panel;
}
