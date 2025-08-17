const api = {
    requestRangeEvents: (fromUtc, toUtc) =>
        webviewApi.postMessage({ name: 'requestRangeEvents', fromUtc, toUtc }),
    requestOpenNote: (id) =>
        webviewApi.postMessage({ name: 'openNote', id }),
    requestExportIcs: (fromUtc, toUtc) =>
        webviewApi.postMessage({ name: 'exportRangeIcs', fromUtc, toUtc }),

    onEvents: (cb) =>
        webviewApi.onMessage(msg => { if (msg.name === 'rangeEvents') cb(msg.events || []); }),
    onDayEvents: (cb) =>
        webviewApi.onMessage(msg => { if (msg.name === 'showEvents') cb(msg.events || [], msg.dateUtc); }),
    onIcs: (cb) =>
        webviewApi.onMessage(msg => { if (msg.name === 'rangeIcs') cb(msg.ics, msg.filename); }),
};

class CalendarUI {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.view = 'month';
        this.cursor = new Date();
        this.todayStr = new Date().toISOString().slice(0,10);
        this.events = [];
        this.render();
        this.loadForCurrentView();
    }

    rangeForView() {
        const d = new Date(this.cursor);
        if (this.view === 'day') {
            const start = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 0,0,0);
            const end   = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), 23,59,59,999);
            return { fromUtc: start, toUtc: end };
        }
        if (this.view === 'week') {
            const wd = (d.getDay()+6)%7;
            const monday = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()-wd));
            const sunday = new Date(Date.UTC(monday.getUTCFullYear(), monday.getUTCMonth(), monday.getUTCDate()+6, 23,59,59,999));
            return { fromUtc: monday.getTime(), toUtc: sunday.getTime() };
        }
        const first = new Date(Date.UTC(d.getFullYear(), d.getMonth(), 1));
        const last  = new Date(Date.UTC(d.getFullYear(), d.getMonth()+1, 0, 23,59,59,999));
        return { fromUtc: first.getTime(), toUtc: last.getTime() };
    }

    setView(v){ this.view=v; this.render(); this.loadForCurrentView(); }
    shift(days){ this.cursor.setDate(this.cursor.getDate()+days); this.render(); this.loadForCurrentView(); }
    loadForCurrentView(){ const r=this.rangeForView(); api.requestRangeEvents(r.fromUtc, r.toUtc); }
    isToday(ymd){ return ymd === this.todayStr; }

    render(){
        const y=this.cursor.getFullYear(), m=this.cursor.getMonth(), dd=String(this.cursor.getDate()).padStart(2,'0');
        const title=`${y}-${String(m+1).padStart(2,'0')}${this.view!=='day'?'':'-'+dd}`;
        this.container.innerHTML='';

        const nav=document.createElement('div'); nav.className='calendar-nav';
        const prev=document.createElement('button'); prev.textContent='◀️';
        const next=document.createElement('button'); next.textContent='▶️';
        const label=document.createElement('span'); label.className='calendar-title'; label.textContent=`${title} (${this.view})`;

        prev.onclick=()=>{ if(this.view==='month') this.cursor.setMonth(this.cursor.getMonth()-1); else if(this.view==='week') this.shift(-7); else this.shift(-1); this.render(); this.loadForCurrentView(); };
        next.onclick=()=>{ if(this.view==='month') this.cursor.setMonth(this.cursor.getMonth()+1); else if(this.view==='week') this.shift(7); else this.shift(1); this.render(); this.loadForCurrentView(); };

        const tabs=document.createElement('div'); tabs.className='view-tabs';
        ['month','week','day'].forEach(v=>{
            const b=document.createElement('button');
            b.textContent=v.toUpperCase();
            b.setAttribute('aria-pressed', String(this.view===v));
            b.onclick=()=>this.setView(v);
            tabs.appendChild(b);
        });

        const exportBtn = document.createElement('button');
        exportBtn.textContent = 'Export .ICS';
        exportBtn.onclick = () => {
            const r = this.rangeForView();
            api.requestExportIcs(r.fromUtc, r.toUtc);
        };

        nav.appendChild(prev); nav.appendChild(label); nav.appendChild(next);
        nav.appendChild(exportBtn);
        this.container.appendChild(nav);
        this.container.appendChild(tabs);

        if (this.view==='month') this.renderMonth();
        else if (this.view==='week') this.renderWeek();
        else this.renderDay();
    }

    setEvents(e){ this.events=e; if (this.view==='month') this.decorateMonth(); if (this.view==='week') this.renderWeek(); if (this.view==='day') this.renderDay(); }

    renderMonth(){
        const y=this.cursor.getFullYear(), m=this.cursor.getMonth();
        const first=new Date(y,m,1), last=new Date(y,m+1,0);
        const skip=(first.getDay()+6)%7, days=last.getDate();

        const table=document.createElement('table'); table.className='calendar';
        const headRow=document.createElement('tr');
        ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(d=>{const th=document.createElement('th'); th.textContent=d; headRow.appendChild(th);});
        table.appendChild(headRow);

        let row=document.createElement('tr');
        for (let i=0;i<skip;i++) row.appendChild(document.createElement('td'));

        for (let day=1; day<=days; day++){
            const dateStr=`${y}-${String(m+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
            const cell=document.createElement('td');
            cell.textContent=String(day);
            cell.className='calendar-day';
            cell.dataset.date=dateStr;
            if (this.isToday(dateStr)) cell.classList.add('today');
            cell.onclick=()=>{ const utc=Date.UTC(y,m,day); webviewApi.postMessage({ name:'dateClick', date: dateStr, dateUtc: utc }); };
            row.appendChild(cell);
            if ((skip+day)%7===0 || day===days){ table.appendChild(row); row=document.createElement('tr'); }
        }

        this.container.appendChild(table);
        this.decorateMonth();
        this.renderEventList([]);
    }

    decorateMonth(){
        const cells=this.container.querySelectorAll('.calendar-day');
        const firstPerDay=new Map();
        for (const ev of this.events){
            const d=new Date(ev.startUtc).toISOString().slice(0,10);
            if (!firstPerDay.has(d)) firstPerDay.set(d, ev);
        }
        cells.forEach(c=>{
            const key=c.dataset.date;
            if (firstPerDay.has(key)){
                const ev=firstPerDay.get(key);
                c.classList.add('has-event');
                if (ev.color){ c.style.backgroundColor=ev.color; c.style.color='#fff'; }
            }
        });
    }

    renderWeek(){
        const wrap=document.createElement('div'); wrap.className='week-grid';
        const wd=(this.cursor.getDay()+6)%7;
        const monday=new Date(this.cursor); monday.setDate(this.cursor.getDate()-wd);
        wrap.innerHTML='';

        for (let i=0;i<7;i++){
            const day=new Date(monday); day.setDate(monday.getDate()+i);
            const key=day.toISOString().slice(0,10);
            const box=document.createElement('div');
            const title=document.createElement('div'); title.textContent=key; title.style.fontWeight='700';
            box.appendChild(title);

            const list=this.events.filter(e=>{
                const s=new Date(e.startUtc).toISOString().slice(0,10);
                const eend=e.endUtc ? new Date(e.endUtc).toISOString().slice(0,10) : s;
                return key>=s && key<=eend;
            }).sort((a,b)=>a.startUtc-b.startUtc);

            for (const ev of list){
                const li=document.createElement('div'); li.className='event-item'; if (ev.color) li.style.borderLeftColor=ev.color;
                const st=new Date(ev.startUtc).toISOString().substring(11,16);
                const et=ev.endUtc? new Date(ev.endUtc).toISOString().substring(11,16):'';
                li.innerHTML=`<span class="event-time">${st}${et?'-'+et:''}</span><a href="#" data-note-id="${ev.id}" class="evt-link">${ev.title}</a>`;
                li.querySelector('.evt-link').addEventListener('click', (e)=>{
                    e.preventDefault();
                    api.requestOpenNote(e.currentTarget.getAttribute('data-note-id'));
                });
                box.appendChild(li);
            }
            wrap.appendChild(box);
        }
        const old=this.container.querySelector('.week-grid'); if (old) old.replaceWith(wrap); else this.container.appendChild(wrap);
        this.renderEventList([]);
    }

    renderDay(){
        const wrap=document.createElement('div'); wrap.className='day-list';
        const key=this.cursor.toISOString().slice(0,10);
        const list=this.events.filter(e=>{
            const s=new Date(e.startUtc).toISOString().slice(0,10);
            const eend=e.endUtc ? new Date(e.endUtc).toISOString().slice(0,10) : s;
            return key>=s && key<=eend;
        }).sort((a,b)=>a.startUtc-b.startUtc);

        wrap.innerHTML=`<div style="font-weight:700">${key}</div>`;
        for (const ev of list){
            const li=document.createElement('div'); li.className='event-item'; if (ev.color) li.style.borderLeftColor=ev.color;
            const st=new Date(ev.startUtc).toISOString().substring(11,16);
            const et=ev.endUtc? new Date(ev.endUtc).toISOString().substring(11,16):'';
            li.innerHTML=`<span class="event-time">${st}${et?'-'+et:''}</span><a href="#" data-note-id="${ev.id}" class="evt-link">${ev.title}</a>`;
            li.querySelector('.evt-link').addEventListener('click', (e)=>{
                e.preventDefault();
                api.requestOpenNote(e.currentTarget.getAttribute('data-note-id'));
            });
            wrap.appendChild(li);
        }
        const old=this.container.querySelector('.day-list'); if (old) old.replaceWith(wrap); else this.container.appendChild(wrap);
        this.renderEventList(list);
    }

    renderEventList(events){
        const box=document.getElementById('events'); box.innerHTML='';
        const cont=document.createElement('div'); cont.className='event-list';
        (events||[]).forEach(ev=>{
            const row=document.createElement('div'); row.className='event-item';
            if (ev.color) row.style.borderLeftColor=ev.color;
            const st=new Date(ev.startUtc).toISOString().substring(11,16);
            const et=ev.endUtc? new Date(ev.endUtc).toISOString().substring(11,16):'';
            row.innerHTML=`<span class="event-time">${st}${et?'-'+et:''}</span><a href="#" data-note-id="${ev.id}" class="evt-link">${ev.title}</a>`;
            row.querySelector('.evt-link').addEventListener('click', (e)=>{
                e.preventDefault();
                api.requestOpenNote(e.currentTarget.getAttribute('data-note-id'));
            });
            cont.appendChild(row);
        });
        box.appendChild(cont);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const ui = new CalendarUI('calendar');

    api.onEvents((events)=> ui.setEvents(events));
    api.onDayEvents((events)=> ui.renderEventList(events));

    api.onIcs((ics, filename)=>{
        const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = filename || 'mycalendar.ics';
        document.body.appendChild(a); a.click();
        setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
    });
});
