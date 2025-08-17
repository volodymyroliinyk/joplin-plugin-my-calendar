// src/ui/calendar.js

(function () {
    // ---- init gate ----
    function init() {
        try {
            console.log('[MyCalendar UI] init start');

            // ---- DOM refs ----
            const $toolbar = () => document.getElementById('mc-toolbar');
            const $grid    = () => document.getElementById('mc-grid');
            const $elist   = () => document.getElementById('mc-events-list');

            // ---- state ----
            let current = startOfMonthUTC(new Date());              // перший день поточного місяця (UTC)
            let selectedDayUtc = toMidnightUTC(new Date());         // вибраний день (UTC початок)
            let rangeEvents = [];                                   // occurrences з бекенда для поточного діапазону

            // ---- utils ----
            function pad2(n){ return String(n).padStart(2,'0'); }
            function toMidnightUTC(d) { return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0,0,0); }
            function startOfMonthUTC(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0,0,0)); }
            function addMonths(dateUtc, delta) { const d = new Date(dateUtc.getTime()); d.setUTCMonth(d.getUTCMonth()+delta); return startOfMonthUTC(d); }
            function monthLabel(d) { return d.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }
            function startOfCalendarGrid(monthUtcDate) {
                const y=monthUtcDate.getUTCFullYear(), m=monthUtcDate.getUTCMonth();
                const d=new Date(Date.UTC(y,m,1,0,0,0));
                const wd=(d.getUTCDay()+6)%7; // Mon=0
                return new Date(d.getTime() - wd*24*3600*1000);
            }
            function endOfCalendarGrid(monthUtcDate) { const s=startOfCalendarGrid(monthUtcDate); return new Date(s.getTime()+42*24*3600*1000-1); }
            function isSameUTCDate(tsUtc, d2) {
                const a=new Date(tsUtc);
                return a.getUTCFullYear()===d2.getUTCFullYear() && a.getUTCMonth()===d2.getUTCMonth() && a.getUTCDate()===d2.getUTCDate();
            }
            function todayUTCDate() { const n=new Date(); return new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate(),0,0,0)); }

            // ---- comms with plugin ----
            async function requestRange(fromUtc, toUtc) {
                if (!window.webviewApi || typeof window.webviewApi.postMessage !== 'function') {
                    console.warn('[MyCalendar UI] webviewApi.postMessage missing');
                    return;
                }
                console.log('[MyCalendar UI] requestRange', new Date(fromUtc).toISOString(), new Date(toUtc).toISOString());
                await window.webviewApi.postMessage({ name: 'requestRangeEvents', fromUtc, toUtc });
            }

            function onPluginMessage(msg) {
                if (!msg || !msg.name) return;
                if (msg.name === 'rangeEvents') {
                    console.log('[MyCalendar UI] got rangeEvents:', msg.events?.length ?? 0);
                    rangeEvents = msg.events || [];
                    paintGrid();
                    renderDayEvents(selectedDayUtc);
                } else if (msg.name === 'showEvents') {
                    console.log('[MyCalendar UI] got showEvents:', msg.events?.length ?? 0);
                    rangeEvents = msg.events || rangeEvents;
                    renderDayEvents(msg.dateUtc);
                } else if (msg.name === 'rangeIcs') {
                    console.log('[MyCalendar UI] got ICS bytes:', (msg.ics || '').length);
                }
            }

            // ---- render toolbar & grid ----
            function renderToolbar() {
                const root = $toolbar(); if (!root) return;
                root.innerHTML = '';
                const wrap = document.createElement('div'); wrap.className='mc-toolbar-inner';

                const btnPrev = button('‹','Попередній місяць',()=>{ current=addMonths(current,-1); drawMonth(); });
                const btnToday = button('Сьогодні','Сьогодні',()=>{ current=startOfMonthUTC(new Date()); selectedDayUtc=toMidnightUTC(new Date()); drawMonth(); });
                const btnNext = button('›','Наступний місяць',()=>{ current=addMonths(current,+1); drawMonth(); });

                const title = document.createElement('div'); title.className='mc-title'; title.textContent=monthLabel(current);

                wrap.appendChild(btnPrev); wrap.appendChild(btnToday); wrap.appendChild(btnNext); wrap.appendChild(title);
                root.appendChild(wrap);
            }

            function button(text,title,onClick){
                const b=document.createElement('button');
                b.className='mc-btn'; b.type='button'; b.title=title; b.textContent=text;
                b.addEventListener('click', onClick);
                return b;
            }

            function drawMonth() {
                renderToolbar();
                renderGridSkeleton();
                const from = startOfCalendarGrid(current);
                const to   = endOfCalendarGrid(current);
                requestRange(from.getTime(), to.getTime());
            }

            function renderGridSkeleton() {
                const grid = $grid(); if (!grid) return;
                grid.innerHTML='';

                const weekdayNames=['Пн','Вт','Ср','Чт','Пт','Сб','Нд'];
                const head=document.createElement('div'); head.className='mc-grid-head';
                for (const n of weekdayNames){ const c=document.createElement('div'); c.className='mc-grid-head-cell'; c.textContent=n; head.appendChild(c); }
                grid.appendChild(head);

                const start=startOfCalendarGrid(current); const today=todayUTCDate();
                const body=document.createElement('div'); body.className='mc-grid-body';

                for (let i=0;i<42;i++){
                    const cellDate=new Date(start.getTime()+i*24*3600*1000);
                    const cell=document.createElement('div'); cell.className='mc-cell';

                    const inThisMonth=cellDate.getUTCMonth()===current.getUTCMonth();
                    if(!inThisMonth) cell.classList.add('mc-out');
                    if (isSameUTCDate(selectedDayUtc, cellDate)) cell.classList.add('mc-selected');
                    if (isSameUTCDate(toMidnightUTC(today), cellDate)) cell.classList.add('mc-today');

                    const n=document.createElement('div'); n.className='mc-daynum'; n.textContent=String(cellDate.getUTCDate());
                    cell.appendChild(n);

                    const dots=document.createElement('div'); dots.className='mc-dots'; dots.dataset.utc=String(toMidnightUTC(cellDate));
                    cell.appendChild(dots);

                    cell.addEventListener('click', ()=>{
                        selectedDayUtc=toMidnightUTC(cellDate);
                        if (window.webviewApi && typeof window.webviewApi.postMessage === 'function') {
                            window.webviewApi.postMessage({ name:'dateClick', dateUtc:selectedDayUtc });
                        }
                        renderDayEvents(selectedDayUtc);
                        paintSelection();
                    });

                    body.appendChild(cell);
                }
                grid.appendChild(body);
            }

            function paintSelection(){
                const body=document.querySelector('#mc-grid .mc-grid-body'); if(!body) return;
                body.querySelectorAll('.mc-cell').forEach(c=>c.classList.remove('mc-selected'));
                const dots=body.querySelector(`.mc-dots[data-utc="${selectedDayUtc}"]`);
                if(dots) dots.parentElement.classList.add('mc-selected');
            }

            function paintGrid(){
                const body=document.querySelector('#mc-grid .mc-grid-body'); if(!body) return;
                body.querySelectorAll('.mc-dots').forEach(d=>d.innerHTML='');

                const byDay=new Map();
                for (const ev of rangeEvents){
                    const dUtc=toMidnightUTC(new Date(ev.startUtc));
                    byDay.set(dUtc,(byDay.get(dUtc)||0)+1);
                }
                byDay.forEach((count,dayUtc)=>{
                    const dots=body.querySelector(`.mc-dots[data-utc="${dayUtc}"]`);
                    if(!dots) return;
                    for(let i=0;i<Math.min(3,count);i++){ const dot=document.createElement('span'); dot.className='mc-dot'; dots.appendChild(dot); }
                    if(count>3){ const more=document.createElement('span'); more.className='mc-more'; more.textContent=`+${count-3}`; dots.appendChild(more); }
                });
            }

            function renderDayEvents(dayStartUtc){
                const ul=$elist(); if(!ul) return;
                ul.innerHTML='';
                const dayEndUtc=dayStartUtc+24*3600*1000-1;
                const dayEvents=rangeEvents.filter(e=>e.startUtc>=dayStartUtc && e.startUtc<=dayEndUtc).sort((a,b)=>a.startUtc-b.startUtc);

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

            // ---- subscribe on messages ----
            if (window.webviewApi?.onMessage) {
                window.webviewApi.onMessage(onPluginMessage);
            } else {
                console.warn('[MyCalendar UI] webviewApi.onMessage missing');
            }

            // ---- first paint ----
            // ВАЖЛИВО: тут не чекаємо DOMContentLoaded, бо скрипт може підвантажитись пізніше
            drawMonth();

            console.log('[MyCalendar UI] init done');
        } catch (e) {
            console.error('[MyCalendar UI] init error', e);
        }
    }

    // Якщо DOM вже готовий — запускаємось негайно, інакше — на подію
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
