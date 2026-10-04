/* Flights app: tiny hash router, a few screens, no framework. */
(() => {
  'use strict';

  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const view = $('#view');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const eur = (n) => '€' + Math.round(n).toLocaleString('nl-NL');
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = (d) => { const [, m, dd] = d.split('-'); return `${+dd} ${MONTHS[m - 1]}`; };
  const weekday = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'short' });
  const stops = (s) => (s === 0 ? 'Direct' : s === 1 ? '1 stop' : `${s} stops`);
  const hours = (min) => (min ? `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}` : '');
  const LEVEL = { extreme: 'Extreme deal', great: 'Great deal', good: 'Good deal' };
  const badge = (l) => (LEVEL[l] ? `<span class="badge ${l}">${LEVEL[l]}</span>` : '');
  const safeUrl = (u) => (/^https:\/\//.test(u || '') ? u : '');
  const ago = (t) => {
    if (!t) return 'not checked yet';
    const s = Date.now() / 1000 - t;
    if (s < 90) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const originName = (c) => (window.ORIGINS.find((o) => o[0] === c) || [c, c])[1];
  const placeName = (c) => (window.ORIGINS.find((o) => o[0] === c) || window.PLACES.find((p) => p[0] === c) || [c, ''])[1];
  const airlineName = (c) => (window.AIRLINES && window.AIRLINES[c]) || c || '';
  // Airline badge: its code on a colour of its own (no logos from other sites).
  const airMark = (c) => {
    if (!c) return '';
    let h = 0;
    for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360;
    return `<span class="al" style="--h:${h}" aria-hidden="true">${esc(c)}</span>`;
  };
  const placeTitle = (w) => (w.kind === 'country' ? `Anywhere in ${w.city}` : w.city);
  const windowLabel = (w) => (w.dateFrom ? `${day(w.from)} – ${day(w.to)}` : `next ${w.months} ${w.months > 1 ? 'months' : 'month'}`);
  const tripLabel = (w) => (w.trip === 'return' ? `${w.minNights}–${w.maxNights} nights` : 'one way');
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    plane: '<svg viewBox="0 0 24 24"><path d="M10.5 13.5L3 11l1.5-1.5 8 1 4-4c1-1 2.6-1.2 3.2-.6s.4 2.2-.6 3.2l-4 4 1 8L14.5 22l-2.5-7.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    bed: '<svg viewBox="0 0 24 24"><path d="M3 18V7M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5"/><circle cx="7" cy="11" r="2"/></svg>',
  };

  let state = { watches: [], unread: 0, source: '', vapid: '' };
  let lastUnread = null;
  let routeData = null;
  const fareCache = new Map();          // fare id -> fare, for the trip details sheet
  let air = { route: 0, codes: [] };    // quick airline filter on the route screen
  const airQuery = () => (air.codes.length ? '&air=' + air.codes.join(',') : '');

  async function api(action, body, params = '') {
    const opt = body ? { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Flights': '1' }, body: JSON.stringify(body) } : {};
    let res;
    try { res = await fetch(`api.php?a=${action}${params}`, { credentials: 'same-origin', ...opt }); } catch { throw new Error('No connection. Try again in a moment.'); }
    let data = {};
    try { data = await res.json(); } catch { /* gate page or network */ }
    if (res.status === 401) throw new Error('Signed out. Reload the app to enter your PIN.');
    if (!res.ok) throw new Error(data.error || 'Could not reach the server.');
    return data;
  }

  function toast(title, text = '', onClick) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = `<b>${esc(title)}</b>${text ? esc(text) : ''}`;
    const close = () => { t.classList.add('out'); setTimeout(() => t.remove(), 300); };
    t.onclick = () => { close(); onClick && onClick(); };
    $('#toasts').append(t);
    setTimeout(close, onClick ? 6000 : 3200);
  }

  /* ------------------------------------------------------------ home */

  function spark(values) {
    if (values.length < 2) return '<span class="muted small">Price trend from tomorrow</span>';
    const w = 120, h = 32, min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 3 - ((v - min) / span) * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0d0f14" stop-opacity=".08"/><stop offset="1" stop-color="#0d0f14" stop-opacity="0"/></linearGradient></defs>
      <path class="a" d="${d} L ${w} ${h} L 0 ${h} Z"/><path class="l" d="${d}"/><circle cx="${last[0]}" cy="${last[1]}" r="3"/></svg>`;
  }

  function change(c) {
    if (c === null || c === undefined || c === 0) return '';
    return `<span class="chg ${c < 0 ? 'down' : 'up'}">${c < 0 ? '↓' : '↑'} ${Math.abs(c)}%</span>`;
  }

  function vsNormal(w) {
    if (!w.low || !w.normal) return `<span class="muted small">${w.scannedAt ? 'Learning the normal price' : ''}</span>`;
    const r = w.low / w.normal;
    if (r < 0.97) return `<span class="vs-mini below">${Math.round((1 - r) * 100)}% below normal</span>`;
    if (r > 1.03) return `<span class="vs-mini above">${Math.round((r - 1) * 100)}% above normal</span>`;
    return '<span class="vs-mini">Normal price</span>';
  }

  function routeCard(w, i) {
    const sub = `${w.origins.join(', ')} → ${w.dest}`;
    const meta = `${w.trip === 'return' ? 'Return' : 'One way'}${w.trip === 'return' ? ` · ${w.minNights}–${w.maxNights} nights` : ''} · ${windowLabel(w)}`;
    const price = w.low
      ? `<div class="p num">${eur(w.low)}</div><div class="n">${w.normal ? 'normally ' + eur(w.normal) : 'lowest found'}</div>`
      : `<div class="n">${w.error ? 'Check failed' : w.scannedAt ? 'No fares' : 'Checking…'}</div>`;
    return `<a class="route enter${w.paused ? ' paused' : ''}" style="animation-delay:${i * 50}ms" href="#/route/${w.id}">
      <div class="route-head">
        <div><div class="route-city">${esc(placeTitle(w))}</div><div class="route-sub">${esc(sub)}</div><div class="route-meta">${esc(meta)}</div></div>
        <div class="route-price">${price}</div>
      </div>
      <div class="route-foot">
        ${spark(w.history)}
        <div class="route-tags">${change(w.change)}${w.paused ? '<span class="badge">Paused</span>' : badge(w.level) || vsNormal(w)}</div>
      </div>
    </a>`;
  }

  function home(animate = true) {
    view.classList.toggle('still', !animate);
    const ws = state.watches;
    const deals = ws.filter((w) => !w.paused && ['great', 'extreme'].includes(w.level)).length;
    // One line that says whether prices are live and fresh; a warning when the server stopped checking.
    const active = ws.filter((w) => !w.paused);
    const last = Math.max(0, ...active.map((w) => w.scannedAt || 0));
    const stale = active.length && last && Date.now() / 1000 - last > (state.everyHours * 2 + 1) * 3600;
    const demo = state.source === 'Demo data'
      ? `<div class="demo-note enter">${ICON.plane}<div><b>Demo prices.</b> Real prices start as soon as the Aviasales token is added on the server.</div></div>`
      : stale
        ? `<div class="demo-note warn enter">${ICON.refresh}<div><b>Prices were last checked ${ago(last)}.</b> The automatic check every ${state.everyHours} hours seems to have stopped. Check the scheduled task in Plesk.</div></div>`
        : '';
    const live = state.source !== 'Demo data' && last && !stale
      ? `<div class="live"><i></i>Live prices · checked ${ago(last)} · every ${state.everyHours} h</div>` : '';
    if (!ws.length) {
      view.innerHTML = `${demo}<div class="empty enter">
        <svg class="art" viewBox="0 0 220 110" aria-hidden="true"><path class="arc" d="M20 90 C 70 10, 150 10, 200 90"/><circle cx="20" cy="90" r="4" fill="#0d0f14"/><circle cx="200" cy="90" r="4" fill="#0f9f62"/><circle class="plane" r="4"/></svg>
        <h2>Where do you want to go?</h2>
        <p>Add a city or a whole country. I check prices every few hours and tell you the moment a fare gets really cheap.</p>
        <button class="btn primary" data-add>${ICON.plus} Track a route</button></div>`;
      return;
    }
    const best = ws.filter((w) => w.low && !w.paused).sort((a, b) => a.low / (a.normal || a.low) - b.low / (b.normal || b.low))[0];
    view.innerHTML = `
      <div class="hello enter"><h1>${deals ? `${deals} cheap ${deals > 1 ? 'routes' : 'route'} right now` : 'Watching your routes'}</h1>
      <p>${ws.length} ${ws.length > 1 ? 'routes' : 'route'} tracked${best ? ` · best: ${esc(placeTitle(best))} from ${eur(best.low)}` : ''}</p>${live}</div>
      ${demo}
      <div class="routes">${ws.map(routeCard).join('')}</div>
      <button class="btn primary fab" data-add>${ICON.plus} Track a route</button>`;
  }

  /* ------------------------------------------------------------ route detail */

  function priceClass(p, normal) {
    if (!normal) return 'c-n';
    const r = p / normal;
    return r <= 0.55 ? 'c-x' : r <= 0.7 ? 'c-g' : r <= 0.85 ? 'c-o' : r <= 1.05 ? 'c-n' : 'c-h';
  }

  function chart(history, range) {
    const pts = range === 'all' ? history : history.slice(-range);
    if (pts.length < 2) {
      return `<div class="chart-empty">${pts.length ? `Today's lowest: <b>${eur(pts[0].low)}</b>. ` : ''}The graph fills in with every check. Come back tomorrow to see the trend.</div>`;
    }
    const W = 640, H = 200, padL = 8, padR = 8, padT = 14, padB = 22;
    const vals = pts.flatMap((p) => [p.low, p.normal].filter(Boolean));
    let min = Math.min(...vals), max = Math.max(...vals);
    const pad = (max - min) * 0.12 || 20; min -= pad; max += pad;
    const x = (i) => padL + (i / (pts.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const line = (key) => pts.map((p, i) => (p[key] ? `${i && pts[i - 1][key] ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p[key]).toFixed(1)}` : '')).join(' ');
    const low = line('low');
    const lowIdx = pts.reduce((b, p, i) => (p.low < pts[b].low ? i : b), 0);
    const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i) => `<span style="left:${(x(i) / W) * 100}%">${day(pts[i].day)}</span>`).join('');
    return `<div class="chart" data-chart='${esc(JSON.stringify(pts.map((p, i) => [x(i) / W, y(p.low) / H, p.day, p.low, p.normal])))}'>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Price history">
        <defs><linearGradient id="cfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f9f62" stop-opacity=".16"/><stop offset="1" stop-color="#0f9f62" stop-opacity="0"/></linearGradient></defs>
        <path class="c-area" d="${low} L ${x(pts.length - 1)} ${H - padB} L ${x(0)} ${H - padB} Z"/>
        <path class="c-normal" d="${line('normal')}" vector-effect="non-scaling-stroke"/>
        <path class="c-low" d="${low}" pathLength="1" vector-effect="non-scaling-stroke"/>
      </svg>
      <div class="c-min" style="left:${(x(lowIdx) / W) * 100}%;top:${(y(pts[lowIdx].low) / H) * 100}%"></div>
      <div class="c-ticks">${ticks}</div>
      <div class="c-guide" hidden></div><div class="c-dot" hidden></div><div class="c-tip" hidden></div>
    </div>
    <div class="chart-legend"><span><i class="lg-low"></i>Lowest fare that day</span><span><i class="lg-normal"></i>Normal price</span></div>`;
  }

  function bindChart(root) {
    const el = $('.chart', root);
    if (!el) return;
    const pts = JSON.parse(el.dataset.chart);
    const guide = $('.c-guide', el), dot = $('.c-dot', el), tip = $('.c-tip', el);
    const show = (e) => {
      const r = el.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const p = pts.reduce((b, q) => (Math.abs(q[0] - fx) < Math.abs(b[0] - fx) ? q : b), pts[0]);
      guide.hidden = dot.hidden = tip.hidden = false;
      guide.style.left = dot.style.left = p[0] * 100 + '%';
      dot.style.top = p[1] * 100 + '%';
      tip.innerHTML = `<b>${eur(p[3])}</b>${weekday(p[2])} ${day(p[2])}${p[4] ? `<br><span>normal ${eur(p[4])}</span>` : ''}`;
      tip.style.left = Math.min(Math.max(p[0] * r.width, 60), r.width - 60) + 'px';
    };
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerdown', show);
    el.addEventListener('pointerleave', () => { guide.hidden = dot.hidden = tip.hidden = true; });
  }

  function calendar(cal, normal, month, from, to) {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1), days = new Date(y, m, 0).getDate();
    const lead = (first.getDay() + 6) % 7;
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cd empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const p = cal[key];
      const out = key < from || key > to;
      cells += p
        ? `<button class="cd ${priceClass(p, normal)}" data-day="${key}" style="animation-delay:${d * 8}ms"><span>${d}</span><b>${p >= 1000 ? Math.round(p / 100) / 10 + 'k' : p}</b></button>`
        : `<div class="cd none${out ? ' out' : ''}"><span>${d}</span></div>`;
    }
    return `<div class="cal-head">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div><div class="cal">${cells}</div>`;
  }

  function bars(rows, title, fmt = (r) => esc(r.key)) {
    if (!rows || rows.length < 2) return '';
    const max = Math.max(...rows.map((r) => r.price)), min = Math.min(...rows.map((r) => r.price));
    return `<div class="panel enter"><div class="panel-t">${title}</div>${rows.map((r) => `
      <div class="hb"><span class="hb-l">${fmt(r)}</span><span class="hb-bar"><i class="${r.price === min ? 'best' : ''}" style="width:${18 + ((r.price - min) / (max - min || 1)) * 82}%"></i></span><span class="hb-p num">${eur(r.price)}</span></div>`).join('')}</div>`;
  }

  function fareRow(f, country) {
    fareCache.set(String(f.id), f);
    const when = `${weekday(f.depart)} ${day(f.depart)}${f.depTime ? ` <span class="t">${esc(f.depTime)}</span>` : ''}${f.ret ? ` – ${weekday(f.ret)} ${day(f.ret)}` : ''}`;
    return `<button class="fare" data-fare="${+f.id}" aria-label="Trip details">
        <div class="d">${when}</div>
        <div class="p num">${eur(f.price)}</div>
        <div class="s">${airMark(f.airline)}<span>${f.airlineName ? esc(f.airlineName) + ' · ' : ''}${f.origin} → ${country && f.destName ? esc(f.destName) + ' ' : ''}${f.dest} · ${f.ret ? f.nights + ' nights · ' : ''}${stops(f.stops)}</span></div>
        <div class="b">${f.isNew ? '<span class="badge new">New</span> ' : ''}${badge(f.level)}<svg class="go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></div>
      </button>`;
  }

  /* One leg of a trip, as a small timeline: leave, the flight, arrive. */
  function leg(label, date, time, from, to, airline, flightNo, nStops, mins) {
    const st = nStops === null || nStops === undefined ? null : nStops;
    return `<div class="leg">
      <div class="leg-h"><b>${label}</b><span>${weekday(date)} ${day(date)}</span></div>
      <div class="tl">
        <div class="tl-pt"><i></i><div><div class="tl-t">${time ? esc(time) : '<span class="muted">Time on booking site</span>'}</div><div class="tl-p">${esc(placeName(from) || from)} <small>${esc(from)}</small></div></div></div>
        <div class="tl-mid">
          <div class="tl-fl">${airMark(airline)}<span>${esc(airlineName(airline)) || 'Airline on booking site'}${flightNo ? ` · <span class="muted">${esc(flightNo)}</span>` : ''}</span></div>
          <div class="tl-info">${mins ? `<span>${ICON.clock}${hours(mins)}</span>` : ''}${st !== null ? `<span class="${st === 0 ? 'ok' : ''}">${st === 0 ? 'Direct flight' : st === 1 ? '1 stop on the way' : `${st} stops on the way`}</span>` : ''}</div>
        </div>
        <div class="tl-pt end"><i></i><div><div class="tl-p">${esc(placeName(to) || to)} <small>${esc(to)}</small></div></div></div>
      </div>
    </div>`;
  }

  function tripSheet(f) {
    const w = routeData.watch;
    const destLabel = f.destName || (w.kind === 'city' ? w.city : f.dest);
    const back = f.ret ? (f.durBack || null) : null;
    const total = f.durOut && (back || !f.ret) ? f.durOut + (back || 0) : f.duration;
    const facts = [
      ['Price', eur(f.price), 'per person'],
      f.ret ? ['Away', `${f.nights} nights`, `${day(f.depart)} – ${day(f.ret)}`] : ['Trip', 'One way', day(f.depart)],
      ['Stops', f.stops === 0 ? 'Direct' : `Max ${f.stops}`, f.ret ? 'each way' : ''],
      ['Flying time', total ? hours(total) : '–', f.ret && total ? 'there and back' : ''],
    ];
    openSheet(`
      <div class="trip-head">
        <div><div class="trip-route">${esc(originName(f.origin))} <span class="arrow">${f.ret ? '⇄' : '→'}</span> ${esc(destLabel)}</div>
        <div class="muted">${f.ret ? 'Return trip' : 'One way'} · ${esc(f.airlineName || airlineName(f.airline) || 'airline on booking site')}</div></div>
        <div class="trip-price num">${eur(f.price)}${badge(f.level) ? `<div>${badge(f.level)}</div>` : ''}</div>
      </div>
      ${leg('Outbound', f.depart, f.depTime, f.origin, f.dest, f.airline, f.flightNo, f.stopsOut ?? (f.ret ? null : f.stops), f.durOut || (f.ret ? null : f.duration))}
      ${f.ret ? `<div class="stay">${ICON.bed}<span><b>${f.nights} nights</b> in ${esc(destLabel)}</span></div>
        ${leg('Return', f.ret, f.retTime, f.dest, f.origin, f.airline, null, f.stopsBack, f.durBack)}` : ''}
      <div class="facts">${facts.map(([l, v, s]) => `<div><span>${l}</span><b class="num">${v}</b>${s ? `<small>${esc(s)}</small>` : ''}</div>`).join('')}</div>
      <p class="muted small trip-note">${f.depTime ? '' : 'Times show up after the next price check. '}Price for 1 adult in economy, as found by Aviasales users in the last few days. Always confirm on the booking site.</p>
      <div class="sheet-foot trip-actions">
        ${safeUrl(f.book) ? `<a class="btn deal block" href="${esc(f.book)}" target="_blank" rel="noopener noreferrer">Book this fare</a>` : ''}
        <a class="btn block" href="${esc(safeUrl(f.google))}" target="_blank" rel="noopener noreferrer">Check on Google Flights</a>
      </div>`);
  }

  /* Quick filter: tap airlines to see only their fares (does not change the route itself). */
  function airChips(data) {
    const list = data.airlines || [];
    if (list.length < 2 && !air.codes.length) return '';
    const saved = data.watch.airlines.length;
    return `<div class="air enter">
      <div class="air-h"><b>Airlines</b><span class="muted">${saved ? 'only the airlines in this route’s settings' : air.codes.length ? `${air.codes.length} selected · <button class="link" data-air="">Show all</button>` : 'tap to filter'}</span></div>
      <div class="air-row">
        <button class="ac${air.codes.length ? '' : ' on'}" data-air="">All</button>
        ${list.map((a) => `<button class="ac${air.codes.includes(a.key) ? ' on' : ''}" data-air="${esc(a.key)}">${airMark(a.key)}<span>${esc(a.name)}</span><em class="num">${eur(a.price)}</em></button>`).join('')}
      </div>
    </div>`;
  }

  let pollTimer;
  async function route(id, quiet) {
    clearTimeout(pollTimer);
    if (!quiet) view.innerHTML = '<div class="skeleton" style="margin-top:60px"></div><div class="skeleton" style="margin-top:14px;height:220px"></div>';
    if (air.route !== id) air = { route: id, codes: [] };
    let data;
    try { data = await api('route', null, `&id=${id}${airQuery()}`); } catch (e) { view.innerHTML = `<div class="empty"><h2>Can't load this route</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back to routes</a></div>`; return; }
    if (location.hash !== `#/route/${id}`) return;
    routeData = data;
    const w = data.watch, fares = data.fares, st = data.stats;
    const country = w.kind === 'country';

    // First check still running (right after adding a route): show progress and look again shortly.
    if (!w.scannedAt) {
      view.innerHTML = `<button class="back" data-back>${ICON.back} Routes</button>
        <div class="detail-head enter"><h1>${esc(placeTitle(w))}</h1></div>
        <div class="hero enter checking"><div class="pulse-plane">${ICON.plane}</div><div class="label">Finding the cheapest fares…</div>
        <p class="muted">Checking ${w.origins.length} ${w.origins.length > 1 ? 'airports' : 'airport'}${country ? ` and ${w.cities.length} cities` : ''} for the ${windowLabel(w)}. This takes a few seconds${country ? ', up to a minute' : ''}.</p></div>`;
      pollTimer = setTimeout(() => route(id, true), 3000);
      return;
    }

    const best = fares[0];
    const ratio = best && w.normal ? best.price / w.normal : null;
    const pinPos = ratio ? Math.max(3, Math.min(97, ((ratio - 0.3) / 0.9) * 100)) : 50;
    const normalPos = ((1 - 0.3) / 0.9) * 100;
    const months = [...new Set(Object.keys(data.calendar).map((d) => d.slice(0, 7)))].sort();
    const byMonth = {};
    Object.entries(data.calendar).forEach(([d, p]) => { const m = d.slice(0, 7); byMonth[m] = Math.min(byMonth[m] || 1e9, p); });
    const bestMonth = months.reduce((b, m) => (byMonth[m] < byMonth[b] ? m : b), months[0]);
    const mMax = Math.max(...Object.values(byMonth), 1), mMin = Math.min(...Object.values(byMonth));
    let range = 30;
    try { const r = localStorage.getItem('fl-range'); range = r === 'all' ? 'all' : +r || 30; } catch { /* private mode */ }

    const tiles = [
      ['Lowest now', best ? eur(best.price) : '–', w.change ? change(w.change) + ' since yesterday' : ''],
      ['Normal price', w.normal ? eur(w.normal) : '–', w.normal ? 'median of daily lows' : 'needs a few checks'],
      ['Lowest ever seen', st.lowestEver ? eur(st.lowestEver) : '–', st.lowestEverDay ? 'on ' + day(st.lowestEverDay) : ''],
      ['Last 7 days', st.week !== null ? `${st.week > 0 ? '+' : ''}${st.week}%` : '–', st.week !== null ? (st.week < 0 ? 'getting cheaper' : st.week > 0 ? 'getting pricier' : 'steady') : `${st.days} ${st.days === 1 ? 'day' : 'days'} of history`],
    ];

    view.innerHTML = `
      <button class="back" data-back>${ICON.back} Routes</button>
      <div class="detail-head enter">
        <h1>${esc(placeTitle(w))}</h1>
        <div class="route-sub">${w.origins.map(originName).join(', ')} → ${country ? esc(w.cities.join(', ')) : `${esc(w.city)} (${w.dest})`}</div>
        <div class="chips-row">
          <span class="tag">${w.trip === 'return' ? 'Return' : 'One way'}</span>${w.trip === 'return' ? `<span class="tag">${w.minNights}–${w.maxNights} nights</span>` : ''}
          <span class="tag">${esc(windowLabel(w))}</span><span class="tag">${w.maxStops < 0 ? 'Any stops' : w.maxStops === 0 ? 'Direct only' : 'Max 1 stop'}</span>
          <span class="tag">Alerts: ${{ extreme: 'extreme only', great: 'great +', good: 'every deal' }[w.alert]}${w.maxPrice ? ` or below ${eur(w.maxPrice)}` : ''}</span>
          ${w.airlines.length ? `<span class="tag">Only ${esc(w.airlines.map(airlineName).join(', '))}</span>` : ''}
          ${w.paused ? '<span class="tag warn">Paused</span>' : ''}
        </div>
      </div>

      <div class="hero enter enter-2">
        ${best ? `
          <div class="label">Cheapest right now${country && best.destName ? ` · ${esc(best.destName)}` : ''}${air.codes.length ? ` · ${esc(air.codes.map(airlineName).join(', '))}` : ''}</div>
          <div class="big num">${eur(best.price)}</div>
          ${ratio ? `<div class="vs ${ratio < 0.97 ? 'below' : ratio > 1.03 ? 'above' : ''}">${ratio < 0.97 ? `${Math.round((1 - ratio) * 100)}% below normal` : ratio > 1.03 ? `${Math.round((ratio - 1) * 100)}% above normal` : 'About the normal price'}</div>` : ''}
          <div class="hero-sub">${weekday(best.depart)} ${day(best.depart)}${best.ret ? ` – ${day(best.ret)} · ${best.nights} nights` : ''} · ${stops(best.stops)}${best.airlineName ? ' · ' + esc(best.airlineName) : ''} &nbsp;${badge(best.level)}</div>
          ${w.normal ? `<div class="meter"><div class="mark" style="left:${normalPos}%"></div><div class="pin" style="left:${normalPos}%" data-pin="${pinPos}"></div></div>
          <div class="meter-legend"><span>Steal</span><span>Normal ${eur(w.normal)}</span><span>Pricey</span></div>` : ''}
          <div class="hero-actions">
            ${safeUrl(best.book) ? `<a class="btn deal" href="${esc(best.book)}" target="_blank" rel="noopener noreferrer">Book this fare</a>` : ''}
            <a class="btn" href="${esc(safeUrl(best.google))}" target="_blank" rel="noopener noreferrer">Google Flights</a>
          </div>`
        : air.codes.length
          ? `<div class="label">No fares from ${esc(air.codes.map(airlineName).join(', '))} right now</div><p class="muted"><button class="link" data-air="">Show all airlines</button></p>`
          : `<div class="label">${w.error ? esc(w.error) : 'No fares match right now'}</div><p class="muted">Try more nights, more airports, a longer window or allow stops${w.airlines.length ? ', or more airlines' : ''}.</p>`}
      </div>
      <p class="muted small-print enter enter-3">Checked ${ago(w.scannedAt)} · ${data.total} matching fares · prices Aviasales users found in the last few days. Always confirm the price before you book.</p>

      ${airChips(data)}

      <div class="tiles enter">${tiles.map(([l, v, s]) => `<div class="tile"><div class="tl">${l}</div><div class="tv num">${v}</div><div class="ts">${s}</div></div>`).join('')}</div>

      <div class="panel enter">
        <div class="panel-t">Price history <div class="seg mini" data-range>${[[30, '30 d'], [90, '90 d'], ['all', 'All']].map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(range) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
        <div id="chart-box">${chart(data.history, range)}</div>
      </div>

      ${months.length ? `<div class="panel enter">
        <div class="panel-t">When to fly <span class="muted">tap a day</span></div>
        <div class="months">${months.map((m, i) => `<button class="m${m === bestMonth ? ' on' : ''}" data-month="${m}"><div class="bar${m === bestMonth ? ' best' : ''}" style="height:${14 + ((byMonth[m] - mMin) / (mMax - mMin || 1)) * 42}px;animation-delay:${i * 40}ms"></div><span>${MONTHS[+m.slice(5) - 1]}</span><em class="num">${eur(byMonth[m])}</em></button>`).join('')}</div>
        <div class="cal-title" id="cal-title">${MONTHS_LONG[+bestMonth.slice(5) - 1]} ${bestMonth.slice(0, 4)}</div>
        <div id="cal-box">${calendar(data.calendar, w.normal, bestMonth, w.from, w.to)}</div>
        <div class="cal-legend"><span class="c-x">Steal</span><span class="c-g">Great</span><span class="c-o">Good</span><span class="c-n">Normal</span><span class="c-h">Pricey</span></div>
      </div>` : ''}

      <div class="section-title" id="fares-title">Best dates</div>
      <div class="fares enter" id="fares">${fares.length ? fares.slice(0, 8).map((f) => fareRow(f, country)).join('') : '<p class="muted pad">No fares yet.</p>'}</div>
      ${fares.length > 8 ? `<button class="btn ghost block more" data-more>Show ${fares.length - 8} more dates</button>` : ''}

      <div class="grid2">
        ${country ? bars(data.byCity, 'Cheapest per city') : ''}
        ${bars(data.byOrigin, 'Cheapest per departure airport', (r) => `${esc(originName(r.key))} <small>${esc(r.key)}</small>`)}
        ${bars(data.byWeekday, 'Cheapest day of the week to leave')}
        ${bars(data.byStops, 'Direct or with stops')}
      </div>

      ${data.alerts.length ? `<div class="section-title">Alerts for this route</div><div class="panel">${data.alerts.map((a) => `<div class="mini-alert"><b>${esc(a.title)}</b><span>${ago(a.at)}</span></div>`).join('')}</div>` : ''}

      <div class="settings-row">
        <button class="btn small ghost" data-scan="${w.id}">${ICON.refresh} Check now</button>
        <button class="btn small ghost" data-edit="${w.id}">Edit</button>
        <button class="btn small ghost" data-pause="${w.id}" data-paused="${w.paused ? 1 : 0}">${w.paused ? 'Resume' : 'Pause'}</button>
        <button class="btn small ghost danger" data-delete="${w.id}">Delete</button>
      </div>`;
    requestAnimationFrame(() => setTimeout(() => { const p = $('[data-pin]'); if (p) p.style.left = p.dataset.pin + '%'; }, 120));
    bindChart(view);
  }

  async function showDay(dayKey) {
    const w = routeData.watch;
    $$('.cd.on').forEach((c) => c.classList.remove('on'));
    $(`.cd[data-day="${dayKey}"]`)?.classList.add('on');
    const list = $('#fares');
    list.classList.add('loading');
    try {
      const r = await api('fares', null, `&id=${w.id}&day=${dayKey}${airQuery()}`);
      $('#fares-title').innerHTML = `Leaving ${weekday(dayKey)} ${day(dayKey)} <button class="link" data-allfares>Show best dates</button>`;
      list.innerHTML = r.fares.map((f) => fareRow(f, w.kind === 'country')).join('') || '<p class="muted pad">No fares that day.</p>';
      if ($('[data-more]')) $('[data-more]').hidden = true;
      list.classList.remove('loading');
      $('#fares-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message); list.classList.remove('loading'); }
  }

  /* ------------------------------------------------------------ sheets */

  function openSheet(html, onMount) {
    closeSheet(true);
    const root = $('#sheet-root');
    root.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><button class="x" aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>${html}</div>`;
    $('.scrim', root).onclick = () => closeSheet();
    $('.x', root).onclick = () => closeSheet();
    document.body.style.overflow = 'hidden';
    onMount && onMount($('.sheet', root));
  }
  function closeSheet(instant) {
    const root = $('#sheet-root');
    document.body.style.overflow = '';
    if (!root.firstChild) return;
    if (instant) { root.innerHTML = ''; return; }
    $$('.scrim, .sheet', root).forEach((el) => el.classList.add('out'));
    setTimeout(() => { root.innerHTML = ''; }, 240);
  }

  function localPlaces(t) {
    const out = [], countries = new Map();
    for (const [code, city, country, cc] of window.PLACES) {
      if (country.toLowerCase().startsWith(t) && !countries.has(cc)) countries.set(cc, { kind: 'country', code: cc, city: country, country });
      if (city.toLowerCase().startsWith(t) || code.toLowerCase() === t) out.push({ kind: 'city', code, city, country });
    }
    return [...countries.values(), ...out].slice(0, 7);
  }

  function editSheet(w) {
    const today = new Date().toISOString().slice(0, 10);
    const f = w ? { ...w } : { kind: 'city', origins: ['AMS', 'EIN', 'RTM'], dest: '', city: '', country: '', trip: 'return', months: 3, dateFrom: null, dateTo: null, minNights: 7, maxNights: 21, maxStops: 1, alert: 'great', maxPrice: null, airlines: [] };
    f.airlines = [...(f.airlines || [])];
    // Airlines to offer as chips: the chosen ones, the ones seen on this route, then a few common ones.
    const seen = w && routeData && routeData.watch.id === w.id ? (routeData.airlines || []).map((a) => a.key) : [];
    let airOffer = [...new Set([...f.airlines, ...seen.slice(0, 8), 'KL', 'HV', 'TK', 'EK', 'QR', 'EY', 'LH', 'AF'])].slice(0, 14);
    let when = f.dateFrom ? 'custom' : String(f.months);
    const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    openSheet(`
      <h2>${w ? 'Edit route' : 'Track a route'}</h2>
      <div class="field"><span class="lbl">From</span><div class="chips" id="origins">${window.ORIGINS.map(([c, n]) => `<button type="button" class="chip${f.origins.includes(c) ? ' on' : ''}" data-o="${c}">${n}<small>${c}</small></button>`).join('')}</div></div>
      <div class="field"><label for="dest">To</label><div id="dest-box"></div><div class="hint">A city, an airport, or a whole country (e.g. Thailand).</div></div>
      <div class="field"><span class="lbl">Trip</span>${seg('trip', [['return', 'Return'], ['oneway', 'One way']], f.trip)}</div>
      <div class="field" id="nights-field" ${f.trip === 'oneway' ? 'hidden' : ''}><span class="lbl">Nights away</span>
        <div class="row2"><label class="inl"><span>From</span><input class="input" type="number" inputmode="numeric" id="minN" min="1" max="60" value="${f.minNights}"></label><label class="inl"><span>To</span><input class="input" type="number" inputmode="numeric" id="maxN" min="1" max="90" value="${f.maxNights}"></label></div></div>
      <div class="field"><span class="lbl">Leaving</span>
        <div class="chips" id="when">${[['1', 'Within 1 month'], ['2', '2 months'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months'], ['custom', 'Pick dates']].map(([v, l]) => `<button type="button" class="chip${when === v ? ' on' : ''}" data-w="${v}">${l}</button>`).join('')}</div>
        <div class="row2" id="dates" ${when === 'custom' ? '' : 'hidden'} style="margin-top:10px">
          <label class="inl"><span>Earliest</span><input class="input" type="date" id="dFrom" min="${today}" value="${f.dateFrom || today}"></label>
          <label class="inl"><span>Latest</span><input class="input" type="date" id="dTo" min="${today}" value="${f.dateTo || ''}"></label></div>
        <div class="hint" id="when-hint">${when === 'custom' ? 'Departure between these dates.' : 'Departure any day from today until then.'}</div></div>
      <div class="field"><span class="lbl">Stops</span>${seg('maxStops', [[0, 'Direct'], [1, 'Max 1'], [-1, 'Any']], f.maxStops)}</div>
      <div class="field"><span class="lbl">Airlines</span><div class="chips" id="airl"></div>
        <div class="air-add"><input class="input" id="air-q" placeholder="Add another airline…" autocomplete="off"><div class="suggest" hidden></div></div>
        <div class="hint" id="air-hint"></div></div>
      <div class="field"><span class="lbl">Notify me about</span>${seg('alert', [['extreme', 'Only extreme'], ['great', 'Great +'], ['good', 'Every deal']], f.alert)}
        <div class="hint">Extreme = 45% or more under the normal price. Great = 30%. Good = 15%.</div>
        <input class="input" style="margin-top:10px" type="number" inputmode="numeric" id="maxPrice" placeholder="And always below € (optional), e.g. 450" value="${f.maxPrice || ''}"></div>
      <div class="sheet-foot"><button class="btn primary block" id="save">${w ? 'Save changes' : 'Start tracking'}</button></div>`, (sheet) => {
      const destBox = $('#dest-box', sheet);
      const renderDest = () => {
        if (f.dest) {
          const label = f.kind === 'country' ? `Anywhere in ${esc(f.city)}` : `${esc(f.city)} <span class="muted">${esc(f.dest)}${f.country ? ' · ' + esc(f.country) : ''}</span>`;
          destBox.innerHTML = `<div class="picked"><span>${label}</span><button type="button">Change</button></div>`;
          $('button', destBox).onclick = () => { f.dest = ''; renderDest(); $('#dest', sheet).focus(); };
          return;
        }
        destBox.innerHTML = `<input class="input" id="dest" placeholder="City, airport or country" autocomplete="off" autocapitalize="words"><div class="suggest" hidden></div>`;
        const input = $('#dest', destBox), box = $('.suggest', destBox);
        let timer;
        const pick = (b) => { clearTimeout(timer); Object.assign(f, { kind: b.dataset.kind, dest: b.dataset.code, city: b.dataset.city, country: b.dataset.country }); renderDest(); };
        const show = (list) => {
          box.hidden = !list.length;
          box.innerHTML = list.map((p) => `<button type="button" data-kind="${p.kind}" data-code="${esc(p.code)}" data-city="${esc(p.city)}" data-country="${esc(p.country)}">
            <span>${p.kind === 'country' ? `<b class="ctry">Anywhere in</b> ${esc(p.city)}` : `${esc(p.city)} <span class="muted">${esc(p.airport || p.country)}</span>`}</span><span class="code">${esc(p.code)}</span></button>`).join('');
        };
        // Pick on press, not on click: the list may be redrawn by the online search mid-tap.
        box.addEventListener('pointerdown', (e) => { const b = e.target.closest('button'); if (b) { e.preventDefault(); pick(b); } });
        input.onkeydown = (e) => { if (e.key === 'Enter') { const b = $('button', box); if (b) { e.preventDefault(); pick(b); } } };
        input.oninput = () => {
          const t = input.value.trim().toLowerCase();
          clearTimeout(timer);
          if (t.length < 2) return show([]);
          const local = localPlaces(t);
          show(local);
          timer = setTimeout(async () => {
            try {
              const r = await api('places', null, '&q=' + encodeURIComponent(t));
              if (input.value.trim().toLowerCase() !== t || f.dest) return;
              const seen = new Set(local.map((p) => p.kind + p.code));
              show([...local, ...r.places.filter((p) => !seen.has(p.kind + p.code))].slice(0, 8));
            } catch { /* offline: built-in list only */ }
          }, 250);
        };
      };
      renderDest();

      // Airlines: none picked = any airline; otherwise only fares from the picked ones count.
      const airBox = $('#airl', sheet), airHint = $('#air-hint', sheet);
      const renderAir = () => {
        airBox.innerHTML = `<button type="button" class="chip${f.airlines.length ? '' : ' on'}" data-al="">Any airline</button>`
          + airOffer.map((c) => `<button type="button" class="chip chip-al${f.airlines.includes(c) ? ' on' : ''}" data-al="${esc(c)}">${airMark(c)}${esc(airlineName(c))}</button>`).join('');
        airHint.textContent = f.airlines.length
          ? `Only ${f.airlines.map(airlineName).join(', ')}. Prices, the normal price and alerts all use just ${f.airlines.length > 1 ? 'these airlines' : 'this airline'}.`
          : 'Every airline counts. Pick one or more to track only those.';
      };
      airBox.addEventListener('click', (e) => {
        const b = e.target.closest('[data-al]');
        if (!b) return;
        const c = b.dataset.al;
        if (!c) f.airlines = [];
        else if (f.airlines.includes(c)) f.airlines = f.airlines.filter((x) => x !== c);
        else if (f.airlines.length >= 12) return toast('At most 12 airlines');
        else f.airlines = [...f.airlines, c];
        renderAir();
      });
      const airQ = $('#air-q', sheet), airSug = $('.air-add .suggest', sheet);
      const addAir = (c) => {
        if (!airOffer.includes(c)) airOffer = [...airOffer, c];
        if (!f.airlines.includes(c) && f.airlines.length < 12) f.airlines = [...f.airlines, c];
        airQ.value = ''; airSug.hidden = true; renderAir();
      };
      airQ.oninput = () => {
        const t = airQ.value.trim().toLowerCase();
        const hits = t.length < 2 ? [] : Object.entries(window.AIRLINES || {})
          .filter(([c, n]) => n.toLowerCase().includes(t) || c.toLowerCase() === t).slice(0, 6);
        airSug.hidden = !hits.length;
        airSug.innerHTML = hits.map(([c, n]) => `<button type="button" data-add-al="${esc(c)}"><span>${airMark(c)} ${esc(n)}</span><span class="code">${esc(c)}</span></button>`).join('');
      };
      airSug.addEventListener('pointerdown', (e) => { const b = e.target.closest('[data-add-al]'); if (b) { e.preventDefault(); addAir(b.dataset.addAl); } });
      airQ.onkeydown = (e) => { if (e.key === 'Enter') { const b = $('[data-add-al]', airSug); if (b) { e.preventDefault(); addAir(b.dataset.addAl); } } };
      renderAir();

      $$('[data-o]', sheet).forEach((b) => (b.onclick = () => {
        b.classList.toggle('on');
        f.origins = $$('[data-o].on', sheet).map((x) => x.dataset.o);
      }));
      $$('[data-w]', sheet).forEach((b) => (b.onclick = () => {
        when = b.dataset.w;
        $$('[data-w]', sheet).forEach((x) => x.classList.toggle('on', x === b));
        $('#dates', sheet).hidden = when !== 'custom';
        $('#when-hint', sheet).textContent = when === 'custom' ? 'Departure between these dates.' : 'Departure any day from today until then.';
      }));
      $$('[data-seg]', sheet).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => {
        $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
        const v = b.dataset.v;
        f[s.dataset.seg] = /^-?\d+$/.test(v) ? +v : v;
        if (s.dataset.seg === 'trip') $('#nights-field', sheet).hidden = v === 'oneway';
      })));
      $('#save', sheet).onclick = async (e) => {
        if (!f.origins.length) return toast('Pick at least one airport to fly from');
        if (!f.dest) return toast('Pick a destination', 'Type a city or country and tap it in the list.');
        f.minNights = +$('#minN', sheet).value || 7;
        f.maxNights = Math.max(f.minNights, +$('#maxN', sheet).value || 21);
        f.maxPrice = +$('#maxPrice', sheet).value || null;
        if (when === 'custom') {
          f.dateFrom = $('#dFrom', sheet).value; f.dateTo = $('#dTo', sheet).value;
          if (!f.dateFrom || !f.dateTo) return toast('Pick both dates');
        } else { f.months = +when; f.dateFrom = f.dateTo = null; }
        const btn = e.currentTarget;
        btn.disabled = true;
        btn.innerHTML = '<span class="spin"></span> Saving…';
        try {
          const body = { kind: f.kind, origins: f.origins, dest: f.dest, city: f.city, country: f.country, trip: f.trip, months: f.months, dateFrom: f.dateFrom, dateTo: f.dateTo, minNights: f.minNights, maxNights: f.maxNights, maxStops: f.maxStops, alert: f.alert, maxPrice: f.maxPrice, airlines: f.airlines };
          const r = await api('save', w ? { ...body, id: w.id } : body);
          closeSheet();
          await refresh();
          if (location.hash === '#/route/' + r.id) route(r.id); else location.hash = '#/route/' + r.id;
          if (!w) toast(`Tracking ${f.kind === 'country' ? 'all of ' + f.city : f.city}`, 'You’ll get a notification when it gets cheap.');
        } catch (err) {
          toast(err.message);
          btn.disabled = false;
          btn.textContent = w ? 'Save changes' : 'Start tracking';
        }
      };
    });
  }

  const isStandalone = () => window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);

  function pushCard() {
    if (isIOS() && !isStandalone()) {
      return `<div class="push-card"><b>Get notifications on your iPhone</b>In Safari tap Share → “Add to Home Screen”. Open Flights from your home screen and turn notifications on here.</div>`;
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return '';
    if (Notification.permission === 'granted') return `<div class="push-card"><b>Notifications are on</b>I'll tell you when a fare gets really cheap.<br><button class="btn small" id="push-test">Send a test</button></div>`;
    if (Notification.permission === 'denied') return '<div class="push-card"><b>Notifications are blocked</b>Allow them for Flights in your phone’s settings.</div>';
    return `<div class="push-card"><b>Turn on notifications</b>So you hear about cheap fares even when the app is closed.<br><button class="btn primary small" id="push-enable">Turn on</button></div>`;
  }

  async function enablePush() {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notifications were not allowed.');
    const key = Uint8Array.from(atob(state.vapid.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    await api('push.subscribe', sub.toJSON());
  }

  async function alertsSheet() {
    let list = [];
    try { list = (await api('alerts')).alerts; } catch (e) { toast(e.message); }
    const item = (a) => `<div class="alert-item ${esc(a.level)}${a.unread ? ' unread' : ''}" data-route="${+a.route || ''}">
        <div class="ic">${ICON.plane}</div>
        <div><div class="t">${esc(a.title)}</div><div class="bd">${esc(a.body)}</div><div class="w">${ago(a.at)}</div></div></div>`;
    openSheet(`<h2>Alerts</h2>${pushCard()}${list.length ? list.map(item).join('') : '<p class="muted">No alerts yet. When a tracked route drops to a deal, it shows up here.</p>'}`, (sheet) => {
      $$('[data-route]', sheet).forEach((el) => (el.onclick = () => { if (el.dataset.route) { closeSheet(); location.hash = '#/route/' + el.dataset.route; } }));
      const en = $('#push-enable', sheet);
      if (en) en.onclick = async () => {
        en.disabled = true;
        try { await enablePush(); toast('Notifications are on'); alertsSheet(); } catch (e) { toast(e.message); en.disabled = false; }
      };
      const test = $('#push-test', sheet);
      if (test) test.onclick = async () => {
        try { await enablePush(); const r = await api('push.test', {}); toast(r.sent ? 'Test sent' : 'No device registered yet'); } catch (e) { toast(e.message); }
      };
    });
    if (state.unread) { await api('read', {}).catch(() => {}); state.unread = 0; lastUnread = 0; updateBell(); }
  }

  /* ------------------------------------------------------------ wiring */

  function updateBell() {
    $('#bell .dot').hidden = !state.unread;
    if ('setAppBadge' in navigator) (state.unread ? navigator.setAppBadge(state.unread) : navigator.clearAppBadge()).catch(() => {});
  }

  async function refresh() {
    state = await api('state');
    if (lastUnread !== null && state.unread > lastUnread) {
      const a = (await api('alerts')).alerts[0];
      if (a) toast(a.title, a.body, () => { location.hash = '#/route/' + a.route; });
    }
    lastUnread = state.unread;
    updateBell();
  }

  async function render() {
    const m = location.hash.match(/^#\/route\/(\d+)/);
    window.scrollTo(0, 0);
    view.classList.remove('still');
    clearTimeout(pollTimer);
    if (m) return route(+m[1]);
    home();
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-more],[data-add],[data-edit],[data-scan],[data-pause],[data-delete],[data-fare],[data-back],[data-month],[data-day],[data-range] button,[data-allfares],[data-air]');
    if (!t) return;
    if (t.matches('[data-fare]')) {
      const f = fareCache.get(t.dataset.fare);
      if (f) tripSheet(f);
      return;
    }
    if (t.matches('[data-air]')) {
      const c = t.dataset.air;
      air.codes = !c ? [] : air.codes.includes(c) ? air.codes.filter((x) => x !== c) : [...air.codes, c];
      const y = scrollY;
      await route(routeData.watch.id, true);
      window.scrollTo(0, y);
      return;
    }
    if (t.matches('[data-more]')) {
      const w = routeData.watch;
      $('#fares').innerHTML = routeData.fares.map((f) => fareRow(f, w.kind === 'country')).join('');
      t.hidden = true;
      return;
    }
    if (t.matches('[data-back]')) { location.hash = '#/'; return; }
    if (t.matches('[data-add]')) return editSheet(null);
    if (t.matches('[data-edit]')) return editSheet(routeData.watch);
    if (t.matches('[data-month]')) {
      $$('[data-month]').forEach((b) => b.classList.toggle('on', b === t));
      const m = t.dataset.month, w = routeData.watch;
      $('#cal-title').textContent = `${MONTHS_LONG[+m.slice(5) - 1]} ${m.slice(0, 4)}`;
      $('#cal-box').innerHTML = calendar(routeData.calendar, w.normal, m, w.from, w.to);
      return;
    }
    if (t.matches('[data-day]')) return showDay(t.dataset.day);
    if (t.matches('[data-allfares]')) {
      const w = routeData.watch;
      $('#fares-title').textContent = 'Best dates';
      $('#fares').innerHTML = routeData.fares.slice(0, 8).map((f) => fareRow(f, w.kind === 'country')).join('');
      $('[data-more]') && ($('[data-more]').hidden = false);
      $$('.cd.on').forEach((c) => c.classList.remove('on'));
      return;
    }
    if (t.matches('[data-range] button')) {
      const v = t.dataset.v;
      try { localStorage.setItem('fl-range', v); } catch { /* private mode */ }
      $$('[data-range] button').forEach((b) => b.classList.toggle('on', b === t));
      $('#chart-box').innerHTML = chart(routeData.history, v === 'all' ? 'all' : +v);
      bindChart(view);
      return;
    }
    const id = +(t.dataset.scan || t.dataset.pause || t.dataset.delete);
    try {
      if (t.matches('[data-scan]')) {
        t.disabled = true;
        t.innerHTML = '<span class="spin"></span> Checking…';
        const r = await api('scan', { id });
        await refresh();
        await route(id, true);
        toast(r.alert ? r.alert.title : r.skipped ? 'Just checked a minute ago' : r.ok === false ? r.error : 'Prices updated');
      } else if (t.matches('[data-pause]')) {
        await api('pause', { id, paused: t.dataset.paused !== '1' });
        await refresh();
        route(id, true);
      } else if (t.matches('[data-delete]')) {
        if (t.dataset.sure) {
          await api('delete', { id });
          await refresh();
          location.hash = '#/';
          toast('Route deleted');
        } else {
          t.dataset.sure = '1';
          t.textContent = 'Tap again to delete';
          setTimeout(() => { delete t.dataset.sure; t.textContent = 'Delete'; }, 3000);
        }
      }
    } catch (err) { toast(err.message); t.disabled = false; }
  });

  $('#bell').onclick = alertsSheet;
  addEventListener('hashchange', render);
  addEventListener('scroll', () => $('.top').classList.toggle('scrolled', scrollY > 4), { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });
  const quietRefresh = () => refresh().then(() => { if (!location.hash.startsWith('#/route/') && !$('#sheet-root').firstChild) home(false); }).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') quietRefresh(); });
  setInterval(() => { if (document.visibilityState === 'visible') quietRefresh(); }, 60000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', (e) => { if (typeof e.data?.url === 'string') location.hash = e.data.url.replace(/^[^#]*/, '') || '#/'; });
  }

  view.innerHTML = '<div class="skeleton" style="margin-top:80px"></div>';
  refresh().then(render).catch((e) => {
    view.innerHTML = `<div class="empty"><h2>Can't load</h2><p>${esc(e.message)}</p><button class="btn" id="retry">Try again</button></div>`;
    $('#retry').onclick = () => location.reload();
  });
})();
