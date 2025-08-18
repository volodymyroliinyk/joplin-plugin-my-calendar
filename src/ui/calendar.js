(function () {
    function log(...args) {
        console.log('[MyCalendar UI]', ...args);
        const box = document.getElementById('mc-log');
        if (box) {
            const line = document.createElement('div');
            line.textContent = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
            box.appendChild(line);
        }
    }

    function init() {
        try {
            log('init start');

            const $toolbar = () => document.getElementById('mc-toolbar');
            const $grid    = () => document.getElementById('mc-grid');
            const $elist   = () => document.getElementById('mc-events-list');

            let current = startOfMonthUTC(new Date());
            let selectedDayUtc = toMidnightUTC(new Date());
            let rangeEvents = [];

            function pad2(n){ return String(n).padStart(2,'0'); }

            function toMidnightUTC(d) {
                return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
            }

            function startOfMonthUTC(d) {
                return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
            }

            function addMonths(dateUtc, delta) {
                const d = new Date(dateUtc.getTime());
                d.setUTCMonth(d.getUTCMonth() + delta);
                return startOfMonthUTC(d);
            }

            function monthLabel(d) {
                return d.toLocaleString('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'});
            }

            function startOfCalendarGrid(monthUtcDate) {
                const y=monthUtcDate.getUTCFullYear(), m=monthUtcDate.getUTCMonth();
                const d=new Date(Date.UTC(y,m,1,0,0,0));
                const wd=(d.getUTCDay()+6)%7; // Mon=0
                return new Date(d.getTime() - wd*24*3600*1000);
            }

            function endOfCalendarGrid(monthUtcDate) {
                const s = startOfCalendarGrid(monthUtcDate);
                return new Date(s.getTime() + 42 * 24 * 3600 * 1000 - 1);
            }

            function isSameUTCDate(tsUtc, d2) {
                const a = new Date(tsUtc);
                return a.getUTCFullYear() === d2.getUTCFullYear() && a.getUTCMonth() === d2.getUTCMonth() && a.getUTCDate() === d2.getUTCDate();
            }

            function todayUTCDate() {
                const n = new Date();
                return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate(), 0, 0, 0));
            }

            // --- рукостискання з беком ---
            if (window.webviewApi?.postMessage) {
                window.webviewApi.postMessage({name: 'uiReady'});
                log('uiReady sent');
            } else {
                log('webviewApi.postMessage missing at init');
            }

            function onPluginMessage(msg) {
                // Joplin інколи шле { message: <payload> }
                if (msg && typeof msg === 'object' && 'message' in msg && msg.message) {
                    msg = msg.message;
                }
                // Якщо раптом прийшов масив подій без name (не повинно, але про всяк випадок)
                if (!msg.name && Array.isArray(msg.events)) {
                    msg = {name: 'rangeEvents', events: msg.events};
                }

                log('onMessage:', msg && msg.name ? msg.name : msg);
                if (!msg || !msg.name) return;

                if (msg.name === 'uiAck') {
                    log('uiAck received');
                    return;
                }

                if (msg.name === 'rangeEvents') {
                    log('got rangeEvents:', (msg.events || []).length);
                    rangeEvents = msg.events || [];
                    paintGrid();
                    renderDayEvents(selectedDayUtc);
                    return;
                }

                if (msg.name === 'showEvents') {
                    log('got showEvents:', (msg.events || []).length);
                    rangeEvents = msg.events || rangeEvents;
                    renderDayEvents(msg.dateUtc);
                    return;
                }

                if (msg.name === 'rangeIcs') {
                    log('got ICS bytes:', (msg.ics || '').length);
                    return;
                }
            }

            if (window.webviewApi?.onMessage) {
                window.webviewApi.onMessage(onPluginMessage);
            } else {
                log('webviewApi.onMessage missing');
            }

            function button(text, title, onClick) {
                const b = document.createElement('button');
                b.className = 'mc-btn';
                b.type = 'button';
                b.title = title;
                b.textContent = text;
                b.addEventListener('click', onClick);
                return b;
            }

            function renderToolbar() {
                const root = $toolbar();
                if (!root) return;
                root.innerHTML = '';
                const wrap = document.createElement('div');
                wrap.className = 'mc-toolbar-inner';

                const btnPrev = button('‹', 'Попередній місяць', () => {
                    current = addMonths(current, -1);
                    drawMonth();
                });
                const btnToday = button('Сьогодні', 'Сьогодні', () => {
                    current = startOfMonthUTC(new Date());
                    selectedDayUtc = toMidnightUTC(new Date());
                    drawMonth();
                });
                const btnNext = button('›', 'Наступний місяць', () => {
                    current = addMonths(current, +1);
                    drawMonth();
                });

                const title = document.createElement('div');
                title.className = 'mc-title';
                title.textContent = monthLabel(current);

                wrap.appendChild(btnPrev); wrap.appendChild(btnToday); wrap.appendChild(btnNext); wrap.appendChild(title);
                root.appendChild(wrap);
            }

            function drawMonth() {
                renderToolbar();
                renderGridSkeleton();
                const from = startOfCalendarGrid(current), to = endOfCalendarGrid(current);
                if (window.webviewApi?.postMessage) {
                    log('requestRange', from.toISOString(), '→', to.toISOString());
                    window.webviewApi.postMessage({
                        name: 'requestRangeEvents',
                        fromUtc: from.getTime(),
                        toUtc: to.getTime()
                    });
                }
            }

            function renderGridSkeleton() {
                const grid = $grid();
                if (!grid) return;
                grid.innerHTML = '';

                const weekdayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];

                const head = document.createElement('div');
                head.className = 'mc-grid-head';
                for (const n of weekdayNames) {
                    const c = document.createElement('div');
                    c.className = 'mc-grid-head-cell';
                    c.textContent = n;
                    head.appendChild(c);
                }
                grid.appendChild(head);

                const body = document.createElement('div');
                body.className = 'mc-grid-body';

                const start = startOfCalendarGrid(current);
                const todayUtcTs = toMidnightUTC(new Date()); // одна цифра UTC-північ сьогодні

                for (let i = 0; i < 42; i++) {
                    const cellDate = new Date(start.getTime() + i * 24 * 3600 * 1000);
                    const cellUtcTs = toMidnightUTC(cellDate);

                    const cell = document.createElement('div');
                    cell.className = 'mc-cell';
                    cell.dataset.utc = String(cellUtcTs);

                    const inThisMonth = cellDate.getUTCMonth() === current.getUTCMonth();
                    if (!inThisMonth) cell.classList.add('mc-out');

                    if (selectedDayUtc === cellUtcTs) cell.classList.add('mc-selected');
                    if (todayUtcTs === cellUtcTs) cell.classList.add('mc-today');

                    const n = document.createElement('div');
                    n.className = 'mc-daynum';
                    n.textContent = String(cellDate.getUTCDate());
                    cell.appendChild(n);

                    const dots = document.createElement('div');
                    dots.className = 'mc-dots';
                    dots.dataset.utc = String(cellUtcTs);
                    cell.appendChild(dots);

                    cell.addEventListener('click', () => {
                        selectedDayUtc = cellUtcTs;
                        window.webviewApi?.postMessage?.({name: 'dateClick', dateUtc: selectedDayUtc});
                        renderDayEvents(selectedDayUtc);
                        paintSelection();
                    });

                    body.appendChild(cell);
                }

                grid.appendChild(body);
            }

            function paintSelection() {
                const body = document.querySelector('#mc-grid .mc-grid-body');
                if (!body) return;
                body.querySelectorAll('.mc-cell').forEach(c => c.classList.remove('mc-selected'));
                const sel = body.querySelector(`.mc-cell[data-utc="${selectedDayUtc}"]`);
                if (sel) sel.classList.add('mc-selected');
            }

            function paintGrid(){
                const body = document.querySelector('#mc-grid .mc-grid-body');
                if (!body) return;

                // Очистити попередні індикатори
                body.querySelectorAll('.mc-bars').forEach(b => b.innerHTML = '');
                body.querySelectorAll('.mc-count').forEach(c => {
                    c.textContent = '';
                    c.style.display = 'none';
                });

                // Зібрати події по днях
                const byDay = new Map(); // dayUtc -> events[]
                for (const ev of rangeEvents) {
                    const dayUtc = toMidnightUTC(new Date(ev.startUtc));
                    if (!byDay.has(dayUtc)) byDay.set(dayUtc, []);
                    byDay.get(dayUtc).push(ev);
                }

                // Допоміжна: отримати/створити дочірні елементи у клітинці
                function ensureParts(cell) {
                    let bars = cell.querySelector(':scope > .mc-bars');
                    let badge = cell.querySelector(':scope > .mc-count');
                    if (!bars) {
                        bars = document.createElement('div');
                        bars.className = 'mc-bars';
                        cell.appendChild(bars);
                    }
                    if (!badge) {
                        badge = document.createElement('div');
                        badge.className = 'mc-count';
                        cell.appendChild(badge);
                    }
                    return {bars, badge};
                }

                // Промалювати
                byDay.forEach((events, dayUtc) => {
                    const cell = body.querySelector(`.mc-cell[data-utc="${dayUtc}"]`);
                    if (!cell) return;

                    const {bars, badge} = ensureParts(cell);

                    // Топ-4 події за часом — тонкі смужки внизу
                    const top = events.slice().sort((a, b) => a.startUtc - b.startUtc).slice(0, 4);
                    for (const ev of top) {
                        const bar = document.createElement('div');
                        bar.className = 'mc-bar';
                        if (ev.color) bar.style.background = ev.color;
                        bars.appendChild(bar);
                    }

                    // Лічильник у правому верхньому куті
                    badge.textContent = String(events.length);
                    badge.style.display = 'block';
                });
            }


            function renderDayEvents(dayStartUtc){
                const ul = $elist();
                if (!ul) return;
                ul.innerHTML = '';
                const dayEndUtc=dayStartUtc+24*3600*1000-1;
                const dayEvents=rangeEvents.filter(e=>e.startUtc>=dayStartUtc && e.startUtc<=dayEndUtc).sort((a,b)=>a.startUtc-b.startUtc);

                log('renderDayEvents', new Date(dayStartUtc).toISOString().slice(0, 10), 'count=', dayEvents.length);

                if(!dayEvents.length){ const li=document.createElement('li'); li.className='mc-empty'; li.textContent='Немає подій'; ul.appendChild(li); return; }

                for (const ev of dayEvents){
                    const li=document.createElement('li'); li.className='mc-event';
                    const time=new Date(ev.startUtc); const hh=pad2(time.getUTCHours()); const mm=pad2(time.getUTCMinutes());
                    const color=document.createElement('span'); color.className='mc-color'; color.style.background=ev.color||'#2d7ff9';
                    const title=document.createElement('span'); title.className='mc-title'; title.textContent=ev.title||'(без назви)';
                    const t=document.createElement('span'); t.className='mc-time'; t.textContent=`${hh}:${mm} UTC`;
                    li.appendChild(color); li.appendChild(title); li.appendChild(t);
                    li.addEventListener('click', ()=>{ window.webviewApi?.postMessage?.({ name:'openNote', id: ev.id }); });
                    ul.appendChild(li);
                }
            }

            // запуск
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', drawMonth);
            } else {
                drawMonth();
            }

            log('init done');
        } catch (e) {
            console.error('[MyCalendar UI] init error', e);
            log('init error', e && e.message ? e.message : String(e));
        }
    }

    // допперевірка інита
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    // helpers локальні:
    function startOfMonthUTC(d) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0));
    }

    function toMidnightUTC(d) {
        return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0);
    }
})();
