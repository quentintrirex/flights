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
  // Airline badge: the airline's logo (served and cached by our own logo.php), with its code on a
  // colour of its own underneath, which shows if there is no logo.
  const airMark = (c) => {
    if (!c) return '';
    let h = 0;
    for (const ch of c) h = (h * 31 + ch.charCodeAt(0)) % 360;
    const logo = /^[A-Z0-9]{2}$/.test(c) ? `<img class="al-logo" src="logo.php?c=${c}" alt="" loading="lazy" decoding="async">` : '';
    return `<span class="al${logo ? ' has-logo' : ''}" style="--h:${h}" aria-hidden="true"><b>${esc(c)}</b>${logo}</span>`;
  };
  // A logo that fails to load is removed, so the code badge shows (no inline handlers: CSP).
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('al-logo')) { t.parentNode.classList.remove('has-logo'); t.remove(); }
  }, true);
  document.addEventListener('load', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('al-logo')) t.parentNode.classList.add('logo-in');
  }, true);
  const placeTitle = (w) => (w.kind === 'country' ? `Anywhere in ${w.city}` : w.city);
  const windowLabel = (w) => (w.dateFrom ? `${day(w.from)} – ${day(w.to)}` : `next ${w.months} ${w.months > 1 ? 'months' : 'month'}`);
  const nightsLabel = (w) => (w.minNights === w.maxNights ? `${w.minNights}` : `${w.minNights}–${w.maxNights >= 45 ? "45+" : w.maxNights}`) + " nights";
  const tripLabel = (w) => (w.trip === "return" ? nightsLabel(w) : "one way");
  const ICON = {
    back: '<svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    plane: '<svg viewBox="0 0 24 24"><path d="M10.5 13.5L3 11l1.5-1.5 8 1 4-4c1-1 2.6-1.2 3.2-.6s.4 2.2-.6 3.2l-4 4 1 8L14.5 22l-2.5-7.5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 5v6h-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    chev: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M9 5v14M15 5v14"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7V5z"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/></svg>',
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
    trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
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
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><defs><linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".08"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs>
      <path class="a" d="${d} L ${w} ${h} L 0 ${h} Z"/><path class="l" d="${d}"/><circle cx="${last[0]}" cy="${last[1]}" r="3"/></svg>`;
  }

  function change(c) {
    if (c === null || c === undefined || c === 0) return '';
    return `<span class="chg ${c < 0 ? 'down' : 'up'}">${c < 0 ? '↓' : '↑'} ${Math.abs(c)}%</span>`;
  }

  /** How today's cheapest fare compares with the usual cheapest fare, in words. */
  function vsNormal(w) {
    if (!w.low) return '';
    if (!w.normal) return learning(w);
    const r = w.low / w.normal;
    if (r < 0.97) return `<span class="vs-mini below">${Math.round((1 - r) * 100)}% below usual</span>`;
    if (r > 1.03) return `<span class="vs-mini above">${Math.round((r - 1) * 100)}% above usual</span>`;
    return '<span class="vs-mini">Usual price</span>';
  }

  /** Until two earlier days of prices exist there is nothing to compare with: say so, with progress. */
  /* ---------- personality: flags, destination colours, a little flight ---------- */
  // Flag emoji where the device has them (iPhone, Mac, Android); Windows has none, so it gets a neat code badge.
  const FLAGS_OK = (() => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 16;
      const x = c.getContext('2d'); x.font = '14px sans-serif'; x.fillText('\u{1F1F3}\u{1F1F1}', 0, 14);
      const d = x.getImageData(0, 0, 16, 16).data;
      for (let i = 0; i < d.length; i += 4) if (d[i + 3] && (Math.abs(d[i] - d[i + 1]) > 30 || Math.abs(d[i + 1] - d[i + 2]) > 30)) return true;
    } catch { /* no canvas */ }
    return false;
  })();
  const flag = (cc) => {
    if (!/^[A-Z]{2}$/.test(cc || '')) return '';
    return FLAGS_OK ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : `<i class="cc">${cc}</i>`;
  };
  // Soft, airy colour pairs; every destination country gets one of them, always the same one.
  const THEMES = [['#dbeafe', '#f0f7ff', '#2563eb'], ['#dcfce7', '#f2fbf5', '#16a34a'], ['#fdeccd', '#fff8ee', '#d97706'], ['#fce7f3', '#fdf3f8', '#db2777'],
    ['#ede9fe', '#f7f5ff', '#7c3aed'], ['#ccfbf1', '#f0fdfa', '#0d9488'], ['#ffe2e5', '#fff3f4', '#e11d48'], ['#e0e7ff', '#f2f4ff', '#4f46e5']];
  const theme = (key) => {
    let h = 0;
    for (const c of String(key || 'x')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const [a, b, c] = THEMES[h % THEMES.length];
    return `--t1:${a};--t2:${b};--t3:${c}`;
  };
  const originFlags = (codes) => [...new Set(codes.map((c) => (window.ORIGINS.find((o) => o[0] === c) || [])[2]).filter(Boolean))].map(flag).join('');
  /** The band at the top of a route: departure flags, a dotted arc with a plane that flies it once, the destination flag. */
  function band(w, big) {
    const path = 'M24 52 C 96 6, 204 6, 276 52';
    return `<div class="band${big ? ' big' : ''}" style="${theme(w.cc || w.dest)}" aria-hidden="true">
      <svg viewBox="0 0 300 64" preserveAspectRatio="none"><path class="arc" d="${path}"/><circle cx="24" cy="52" r="3.5" class="dot-a"/><circle cx="276" cy="52" r="3.5" class="dot-b"/>
        <g class="plane"${matchMedia('(prefers-reduced-motion: reduce)').matches ? ' transform="translate(150 17)"' : ''}><path d="M-6 -1.6 L4 -1.6 L7.5 0 L4 1.6 L-6 1.6 Z M-2 -1.6 L-4.5 -6 L-2.5 -6 L2 -1.6 Z M-2 1.6 L-4.5 6 L-2.5 6 L2 1.6 Z M-6 -1.6 L-7.6 -4 L-6.4 -4 L-4.6 -1.6 Z M-6 1.6 L-7.6 4 L-6.4 4 L-4.6 1.6 Z"/>
        ${matchMedia('(prefers-reduced-motion: reduce)').matches ? '' : `<animateMotion dur="2.4s" begin="0s" fill="freeze" rotate="auto" keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.4 0 0.2 1" path="${path}"/>`}</g></svg>
      <span class="band-from">${originFlags(w.origins)}<b>${esc(w.origins.length > 2 ? `${w.origins.length} airports` : w.origins.join(' · '))}</b></span>
      <span class="band-to">${flag(w.cc) || ICON.plane}</span>
    </div>`;
  }
  const IC = {
    cal: '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
    moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>',
    plane: '<svg viewBox="0 0 24 24"><path d="M10.5 13.5L3 11l1.5-1.5 8 1 4-4c1-1 2.6-1.2 3.2-.6s.4 2.2-.6 3.2l-4 4 1 8L14.5 22l-2.5-7.5"/></svg>',
    stops: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3"/><circle cx="12" cy="12" r="1.2"/></svg>',
    direct: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/></svg>',
  };
  /** The cheapest trip as small icon chips: dates, nights, airline, stops. */
  function tripChips(b, w) {
    if (!b) return '';
    const chips = [
      `${IC.cal}<span>${w.kind === 'country' && b.destName ? `<b>${esc(b.destName)}</b> · ` : ''}${day(b.depart)}${b.ret ? ` – ${day(b.ret)}` : ''}</span>`,
      b.ret ? `${IC.moon}<span>${b.nights} ${b.nights === 1 ? 'night' : 'nights'}</span>` : '',
      b.airlineName ? `${b.airline ? airMark(b.airline) : IC.plane}<span>${esc(b.airlineName)}</span>` : '',
      `${b.stops === 0 ? IC.direct : IC.stops}<span>${b.stops === 0 ? 'Direct' : b.stops === 1 ? '1 stop' : `${b.stops} stops`}</span>`,
    ].filter(Boolean);
    return `<div class="chips-trip">${chips.map((c) => `<span class="ct">${c}</span>`).join('')}</div>`;
  }

  /** One verdict pill for any price against the usual cheapest fare: the same five labels everywhere. */
  function verdict(price, normal) {
    if (!price || !normal) return '';
    const r = price / normal;
    if (r <= 0.55) return '<span class="badge extreme">Extreme deal</span>';
    if (r <= 0.70) return '<span class="badge great">Great deal</span>';
    if (r <= 0.85) return '<span class="badge good">Good deal</span>';
    if (r <= 1.10) return '<span class="badge normal">Normal price</span>';
    return '<span class="badge high">Higher than usual</span>';
  }

  function learning(w) {
    const day = Math.min(3, Math.max(1, w.days || 1));
    return `<span class="learn" title="Deals are price drops compared with the usual cheapest fare. That needs a few days of prices first.">
      <span class="learn-bar">${[1, 2, 3].map((d) => `<i class="${d <= day ? 'on' : ''}"></i>`).join('')}</span>Learning prices · day ${day} of 3</span>`;
  }

  /** The cheapest trip in one readable line: when, how long, with whom, how many stops. */
  function tripLine(b, w) {
    if (!b) return '';
    const where = w.kind === 'country' && b.destName ? `<b>${esc(b.destName)}</b> · ` : '';
    return `${where}${weekday(b.depart)} ${day(b.depart)}${b.ret ? ` – ${weekday(b.ret)} ${day(b.ret)} · ${b.nights} ${b.nights === 1 ? 'night' : 'nights'}` : ''} · ${b.airlineName ? esc(b.airlineName) + ' · ' : ''}${stops(b.stops).toLowerCase()}`;
  }

  /** The route in plain words: the best option, whether it is a deal, and when you will hear from the app. */
  function summaryCard(w, f, ratio, country) {
    const where = country && f.destName ? `${esc(f.destName)}, ${esc(w.city)}` : esc(w.city);
    const leave = `<b>${weekday(f.depart)} ${day(f.depart)}</b>${f.depTime ? ` at ${esc(f.depTime)}` : ''}`;
    const when = f.ret ? `leaving ${leave} and back <b>${weekday(f.ret)} ${day(f.ret)}</b> (${f.nights} nights)` : `leaving ${leave}`;
    const how = `${f.airlineName ? `with <b>${esc(f.airlineName)}</b>, ` : ''}${f.stops === 0 ? 'direct' : f.stops === 1 ? '1 stop' : `${f.stops} stops`}`;
    const pct = ratio ? Math.round(Math.abs(1 - ratio) * 100) : 0;
    let verdict;
    if (!w.normal) verdict = 'There are not enough departure dates yet to judge this price.';
    else if (ratio < 0.97) verdict = `That is <b>${pct}% below</b> the usual cheapest fare of ${eur(w.normal)}${LEVEL[f.level] ? `: ${f.level === 'extreme' ? 'an' : 'a'} <b>${LEVEL[f.level].toLowerCase()}</b>` : ''}.`;
    else if (ratio > 1.03) verdict = `That is ${pct}% above the usual cheapest fare of ${eur(w.normal)}, so prices are higher than normal right now.`;
    else verdict = `That is about the usual cheapest fare (${eur(w.normal)}).`;
    const level = { extreme: 'an extreme deal (45% or more below usual)', great: 'a great deal (30% or more below usual)', good: 'any deal (15% or more below usual)' }[w.alert] || 'a great deal';
    const alert = w.paused ? 'Alerts are paused for this route.' : `You get a notification when a fare becomes ${level}${w.maxPrice ? ` or drops below ${eur(w.maxPrice)}` : ''}.`;
    return `<div class="summary enter">
      <div class="sum-h">${ICON.info}<b>In short</b><button class="link" data-howdeals>How deals work</button></div>
      <p>The cheapest trip to ${where} is <b>${eur(f.price)} ${f.ret ? 'return' : 'one way'}</b> per person, ${how}, ${when}.</p>
      <p>${verdict}</p>
      <p class="sum-alert">${ICON.bell}<span>${alert}</span></p>
    </div>`;
  }

  function howDeals() {
    openSheet(`
      <h2>How deals work</h2>
      <div class="how">
        <p><b>What is a deal?</b> A real price drop. Every check the app notes the cheapest fare for the route. The <b>usual cheapest fare</b> is the middle of those daily lows over the last 30 days. Today’s cheapest fare is compared with that.</p>
        <div class="how-levels">
          <div><span class="badge good">Good deal</span><span>15% or more below usual</span></div>
          <div><span class="badge great">Great deal</span><span>30% or more below usual</span></div>
          <div><span class="badge extreme">Extreme deal</span><span>45% or more below usual</span></div>
          <div><span class="badge normal">Normal price</span><span>around the usual cheapest fare</span></div>
          <div><span class="badge high">Higher than usual</span><span>more than 10% above it</span></div>
        </div>
        <p><b>New routes.</b> On the first days there are no earlier prices yet, so the cheapest fare is compared with a typical cheap fare among your other departure dates. After two days it compares with the previous days.</p>
        <p><b>Notifications.</b> You choose the level per route (Edit → Notify me about), and you can add a price: below that you always hear about it. After an alert, the same route only alerts again within a week if the fare is clearly better.</p>
        <p><b>Where prices come from.</b> Aviasales: fares other travellers found in the last days. They can be a few days old, so always confirm the price on the booking site.</p>
      </div>`);
  }

  function routeCard(w, i) {
    const meta = `${w.trip === 'return' ? 'Return' : 'One way'}${w.trip === 'return' ? ` · ${nightsLabel(w)}` : ''} · ${windowLabel(w)}${w.maxStops === 0 ? ' · direct only' : ''}`;
    const price = w.low
      ? `<div class="p num">${eur(w.low)}</div><div class="n">${w.trip === 'return' ? 'return' : 'one way'} · per person</div>`
      : `<div class="n">${w.error ? 'Check failed' : w.scannedAt ? 'No fares right now' : 'Checking…'}</div>`;
    const status = w.paused ? '<span class="badge normal">Paused</span>' : verdict(w.low, w.normal);
    return `<a class="route enter${w.paused ? ' paused' : ''}" style="animation-delay:${i * 60}ms" href="#/route/${w.id}">
      ${band(w)}
      <div class="route-body">
        <div class="route-head">
          <div><div class="route-city">${esc(placeTitle(w))}</div><div class="route-sub">${esc(meta)}</div></div>
          <div class="route-price">${price}</div>
        </div>
        ${tripChips(w.best, w)}
        <div class="route-foot">
          <div class="route-tags">${status}${w.normal ? change(w.change) : ''}</div>
          ${w.history.length > 1 ? spark(w.history) : ''}
        </div>
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
        <svg class="art" viewBox="0 0 220 110" aria-hidden="true"><path class="arc" d="M20 90 C 70 10, 150 10, 200 90"/><circle cx="20" cy="90" r="4" fill="currentColor"/><circle cx="200" cy="90" r="4" fill="#0f9f62"/><circle class="plane" r="4"/></svg>
        <h2>Where do you want to go?</h2>
        <p>Add a city or a whole country. I check prices every few hours and tell you the moment a fare gets really cheap.</p>
        <button class="btn primary" data-add>${ICON.plus} Track a route</button></div>`;
      return;
    }
    const judged = ws.filter((w) => w.low && w.normal && !w.paused);
    const best = judged.length ? judged.sort((a, b) => a.low / a.normal - b.low / b.normal)[0] : ws.filter((w) => w.low && !w.paused).sort((a, b) => a.low - b.low)[0];
    const dealCount = ws.filter((w) => !w.paused && w.low && w.normal && w.low <= w.normal * 0.85).length;
    let sort = 'deal';
    try { sort = localStorage.getItem('fl-sort') || 'deal'; } catch { /* private mode */ }
    const SORTS = { deal: 'Best deal', price: 'Cheapest', name: 'A–Z', recent: 'Newest' };
    const rank = (w) => (w.paused ? 9 : w.low && w.normal ? w.low / w.normal : 5);
    const sorted = [...ws].sort({
      deal: (a, b) => rank(a) - rank(b),
      price: (a, b) => (a.paused - b.paused) || (a.low || 1e9) - (b.low || 1e9),
      name: (a, b) => placeTitle(a).localeCompare(placeTitle(b)),
      recent: (a, b) => b.id - a.id,
    }[sort] || (() => 0));
    view.innerHTML = `
      <div class="hello enter">
        <p class="greet">${(() => { const h = new Date().getHours(); return h < 6 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; })()} ✈️</p>
        <h1>${dealCount ? `${dealCount} ${dealCount > 1 ? 'deals' : 'deal'} right now` : 'Watching your routes'}</h1>
        <div class="stats">
          <div><span>${IC.plane}Routes</span><b class="num">${ws.length}</b></div>
          <div><span>${ICON.bell}Deals</span><b class="num">${dealCount}</b></div>
          ${best ? `<a href="#/route/${best.id}"><span>${flag(best.cc) || IC.plane}${judged.length ? 'Best deal' : 'Cheapest'}</span><b class="num">${eur(best.low)}</b><small>${esc(placeTitle(best))}</small></a>` : ''}
        </div>
        ${live}
      </div>
      ${demo}
      ${ws.length > 2 ? `<div class="sortbar enter">${Object.entries(SORTS).map(([k, l]) => `<button class="pill${k === sort ? ' on' : ''}" data-sort="${k}">${l}</button>`).join('')}</div>` : ''}
      <div class="routes">${sorted.map(routeCard).join('')}</div>
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
    // Colour by rank among all departure days: the cheapest tenth green, the next fifth light green, the dearest third tinted.
    const all = Object.values(cal).sort((a, b) => a - b);
    const rank = (p) => { const i = all.indexOf(p) / Math.max(1, all.length - 1); return i <= 0.1 ? "c-g" : i <= 0.3 ? "c-o" : i <= 0.67 ? "c-n" : "c-h"; };
    let cells = '';
    for (let i = 0; i < lead; i++) cells += '<div class="cd empty"></div>';
    for (let d = 1; d <= days; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      const p = cal[key];
      const out = key < from || key > to;
      cells += p
        ? `<button class="cd ${rank(p)}" data-day="${key}" style="animation-delay:${d * 8}ms"><span>${d}</span><b>${p >= 1000 ? Math.round(p / 100) / 10 + 'k' : p}</b></button>`
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
      <div class="trip-extra">
        <button class="btn small ghost" data-ics>${ICON.cal} Add to calendar</button>
        <button class="btn small ghost" data-share>${ICON.share} Share</button>
      </div>
      <div class="sheet-foot trip-actions">
        ${safeUrl(f.book) ? `<a class="btn deal block" href="${esc(f.book)}" target="_blank" rel="noopener noreferrer">Book this fare</a>` : ''}
        <a class="btn block" href="${esc(safeUrl(f.google))}" target="_blank" rel="noopener noreferrer">Check on Google Flights</a>
      </div>`, (sheet) => {
      const title = `${originName(f.origin)} → ${destLabel}`;
      const summary = `${title}: ${eur(f.price)} · ${weekday(f.depart)} ${day(f.depart)}${f.depTime ? ' ' + f.depTime : ''}${f.ret ? ` – ${weekday(f.ret)} ${day(f.ret)} (${f.nights} nights)` : ' one way'} · ${stops(f.stops)}${f.airlineName ? ' · ' + f.airlineName : ''}`;
      const link = safeUrl(f.book) || safeUrl(f.google);
      $('[data-ics]', sheet).onclick = () => {
        // One all-day event for the whole trip: flight times are local to each airport, so dates are what is certain.
        const d = (s, add = 0) => { const x = new Date(s + 'T12:00:00'); x.setDate(x.getDate() + add); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
        const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Flights//trirexio//EN', 'BEGIN:VEVENT',
          `UID:${f.id}-${Date.now()}@trirexio.com`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`,
          `DTSTART;VALUE=DATE:${d(f.depart)}`, `DTEND;VALUE=DATE:${d(f.ret || f.depart, 1)}`,
          `SUMMARY:✈ ${title}`, `DESCRIPTION:${summary.replace(/[,;\\]/g, (c) => '\\' + c)}\\n${link}`, `URL:${link}`,
          'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
        a.download = `flight-${f.origin}-${f.dest}-${f.depart}.ics`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      };
      $('[data-share]', sheet).onclick = async () => {
        try {
          if (navigator.share) await navigator.share({ title: `✈ ${title}`, text: summary, url: link });
          else { await navigator.clipboard.writeText(`${summary}\n${link}`); toast('Copied', 'Paste it anywhere.'); }
        } catch { /* cancelled */ }
      };
    });
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
      ['Usual lowest', w.normal ? eur(w.normal) : '–', w.normal ? 'cheapest fare on a typical day' : 'needs more dates'],
      ['Lowest ever seen', st.lowestEver ? eur(st.lowestEver) : '–', st.lowestEverDay ? 'on ' + day(st.lowestEverDay) : ''],
      ['Last 7 days', st.week !== null ? `${st.week > 0 ? '+' : ''}${st.week}%` : '–', st.week !== null ? (st.week < 0 ? 'getting cheaper' : st.week > 0 ? 'getting pricier' : 'steady') : `${st.days} ${st.days === 1 ? 'day' : 'days'} of history`],
    ];

    let tab = 'dates';
    try { tab = sessionStorage.getItem('fl-tab') || 'dates'; } catch { /* private mode */ }
    if (best) fareCache.set(String(best.id), best);
    const meta = [w.trip === 'return' ? `Return · ${nightsLabel(w)}` : 'One way', windowLabel(w),
      w.maxStops < 0 ? 'any stops' : w.maxStops === 0 ? 'direct only' : 'max 1 stop'].join(' · ');
    const vsCls = ratio ? (ratio < 0.97 ? 'below' : ratio > 1.03 ? 'above' : '') : '';
    const vsTxt = ratio ? (ratio < 0.97 ? `${Math.round((1 - ratio) * 100)}% below usual` : ratio > 1.03 ? `${Math.round((ratio - 1) * 100)}% above usual` : 'About the normal price') : '';
    const insights = [country ? bars(data.byCity, 'Cheapest per city') : '',
      bars(data.byOrigin, 'Cheapest per departure airport', (r) => `${esc(originName(r.key))} <small>${esc(r.key)}</small>`),
      bars(data.byNights, 'Cheapest by trip length'), bars(data.byWeekday, 'Cheapest day of the week to leave'), bars(data.byStops, 'Direct or with stops')].join('');
    const panel = (k) => `class="tabp" data-panel="${k}"${tab === k ? '' : ' hidden'}`;

    view.innerHTML = `
      <div class="d-top">
        <button class="back" data-back>${ICON.back} Routes</button>
        <button class="pill-btn" data-edit="${w.id}">${ICON.edit} Edit</button>
      </div>

      <section class="dhero enter" style="${theme(w.cc || w.dest)}">
        ${band(w, true)}
        <h1>${esc(placeTitle(w))}</h1>
        <div class="dh-meta">${esc(meta)}${w.airlines.length ? ` · only ${esc(w.airlines.map(airlineName).join(', '))}` : ''}${w.paused ? ' · <b>paused</b>' : ''}</div>
        ${best ? `
        <div class="dh-price">
          <div>
            <div class="dh-label">${w.trip === 'return' ? 'Cheapest return trip' : 'Cheapest one-way flight'}${air.codes.length ? ` · ${esc(air.codes.map(airlineName).join(', '))}` : ''}</div>
            <div class="dh-big"><span class="num">${eur(best.price)}</span><small class="pp">per person</small></div>
          </div>
          <div class="dh-tags">${verdict(best.price, w.normal)}${ratio ? `<span class="dh-vs ${vsCls}">${vsTxt}</span>` : ''}</div>
        </div>
        <button class="dh-trip" data-fare="${+best.id}">
          ${airMark(best.airline)}
          <span><b>${weekday(best.depart)} ${day(best.depart)}${best.ret ? ` – ${weekday(best.ret)} ${day(best.ret)}` : ''}</b>
          <small>${best.depTime ? `${esc(best.depTime)} · ` : ''}${best.airlineName ? esc(best.airlineName) + ' · ' : ''}${stops(best.stops)}${best.ret ? ` · ${best.nights} nights` : ''}${country && best.destName ? ` · ${esc(best.destName)}` : ''}</small></span>
          <em>Trip details ${ICON.chev}</em>
        </button>
        ${w.normal ? `<div class="meter"><div class="mark" style="left:${normalPos}%"></div><div class="pin" style="left:${normalPos}%" data-pin="${pinPos}"></div></div>
        <div class="meter-legend"><span>Steal</span><span>Usual ${eur(w.normal)}</span><span>Pricey</span></div>` : ''}
        <div class="dh-actions">
          ${safeUrl(best.book) ? `<a class="btn light" href="${esc(best.book)}" target="_blank" rel="noopener noreferrer">Book this fare</a>` : ''}
          <a class="btn glass" href="${esc(safeUrl(best.google))}" target="_blank" rel="noopener noreferrer">Google Flights</a>
        </div>`
        : air.codes.length
          ? `<div class="dh-empty"><b>No fares from ${esc(air.codes.map(airlineName).join(', '))} right now</b><button class="btn glass small" data-air="">Show all airlines</button></div>`
          : `<div class="dh-empty"><b>${w.error ? esc(w.error) : 'No fares match right now'}</b><span>Try more nights, more airports, a longer window or allow stops${w.airlines.length ? ', or more airlines' : ''}.</span></div>`}
      </section>
      ${best ? summaryCard(w, best, ratio, country) : ''}
      <p class="d-print">Checked ${ago(w.scannedAt)} · ${data.total} matching fares · found by Aviasales users in the last few days</p>

      ${airChips(data)}

      <div class="tabs" role="tablist">${[['dates', 'Dates'], ['trend', 'Price trend'], ['insights', 'Insights']]
        .map(([k, l]) => `<button role="tab" data-tab="${k}" class="${tab === k ? 'on' : ''}" aria-selected="${tab === k}">${l}</button>`).join('')}</div>

      <div ${panel('dates')}>
        ${months.length ? `<div class="panel">
          <div class="panel-t">When to fly <span class="muted">tap a day</span></div>
          <div class="months">${months.map((m, i) => `<button class="m${m === bestMonth ? ' on' : ''}" data-month="${m}"><div class="bar${m === bestMonth ? ' best' : ''}" style="height:${14 + ((byMonth[m] - mMin) / (mMax - mMin || 1)) * 42}px;animation-delay:${i * 40}ms"></div><span>${MONTHS[+m.slice(5) - 1]}</span><em class="num">${eur(byMonth[m])}</em></button>`).join('')}</div>
          <div class="cal-title" id="cal-title">${MONTHS_LONG[+bestMonth.slice(5) - 1]} ${bestMonth.slice(0, 4)}</div>
          <div id="cal-box">${calendar(data.calendar, w.normal, bestMonth, w.from, w.to)}</div>
          <div class="cal-legend"><span class="c-g">Cheapest days</span><span class="c-o">Cheap</span><span class="c-n">Typical</span><span class="c-h">Pricier</span></div>
        </div>` : ''}
        <div class="section-title" id="fares-title">Best dates</div>
        <div class="fares" id="fares">${fares.length ? fares.slice(0, 8).map((f) => fareRow(f, country)).join('') : '<p class="muted pad">No fares yet.</p>'}</div>
        ${fares.length > 8 ? `<button class="btn ghost block more" data-more>Show ${fares.length - 8} more dates</button>` : ''}
      </div>

      <div ${panel('trend')}>
        <div class="tiles">${tiles.map(([l, v, s]) => `<div class="tile"><div class="tl">${l}</div><div class="tv num">${v}</div><div class="ts">${s}</div></div>`).join('')}</div>
        <div class="panel">
          <div class="panel-t">Price history <div class="seg mini" data-range>${[[30, '30 d'], [90, '90 d'], ['all', 'All']].map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(range) ? 'on' : ''}">${l}</button>`).join('')}</div></div>
          <div id="chart-box">${chart(data.history, range)}</div>
        </div>
      </div>

      <div ${panel('insights')}>
        ${insights ? `<div class="grid2">${insights}</div>` : '<div class="chart-empty">More insights appear once there are fares from a few dates and airports.</div>'}
        ${data.alerts.length ? `<div class="section-title">Alerts for this route</div><div class="panel">${data.alerts.map((a) => `<div class="mini-alert"><b>${esc(a.title)}</b><span>${ago(a.at)}</span></div>`).join('')}</div>` : ''}
      </div>

      <div class="section-title">Route</div>
      <div class="manage">
        <button data-scan="${w.id}">${ICON.refresh}<span>Check prices now</span></button>
        <button data-edit="${w.id}">${ICON.edit}<span>Edit route</span></button>
        <button data-copy="${w.id}">${ICON.copy}<span>Copy as a new route</span></button>
        <button data-pause="${w.id}" data-paused="${w.paused ? 1 : 0}">${w.paused ? ICON.play : ICON.pause}<span>${w.paused ? 'Resume alerts' : 'Pause alerts'}</span></button>
        <button class="danger" data-delete="${w.id}">${ICON.trash}<span>Delete route</span></button>
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

  function editSheet(w, copyFrom) {
    const today = new Date().toISOString().slice(0, 10);
    const f = w ? { ...w } : copyFrom ? { ...copyFrom, airlines: [...(copyFrom.airlines || [])] } : { kind: 'city', origins: ['AMS', 'EIN', 'RTM'], dest: '', city: '', country: '', trip: 'return', months: 3, dateFrom: null, dateTo: null, minNights: 7, maxNights: 21, maxStops: 1, alert: 'great', maxPrice: null, airlines: [] };
    f.airlines = [...(f.airlines || [])];
    let when = f.dateFrom ? 'custom' : String(f.months);
    const seg = (name, opts, val) => `<div class="seg" data-seg="${name}">${opts.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(val) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    openSheet(`
      <h2>${w ? 'Edit route' : copyFrom ? 'Copy of this route' : 'Track a route'}</h2>${copyFrom ? '<p class="muted copy-note">Change what you want (for example the dates or airports) and save it as a new route.</p>' : ''}
      <div class="field"><span class="lbl">From</span><div class="chips" id="origins">${window.ORIGINS.map(([c, n]) => `<button type="button" class="chip${f.origins.includes(c) ? ' on' : ''}" data-o="${c}">${n}<small>${c}</small></button>`).join('')}</div></div>
      <div class="field"><label for="dest">To</label><div id="dest-box"></div><div class="hint">A city, an airport, or a whole country (e.g. Thailand).</div></div>
      <div class="field"><span class="lbl">Trip</span>${seg('trip', [['return', 'Return'], ['oneway', 'One way']], f.trip)}</div>
      <div class="field when-field"><span class="lbl">When</span>
        <div class="seg" id="when-mode"><button type="button" data-wm="custom" class="${when === 'custom' ? 'on' : ''}">${IC.cal}Date range</button><button type="button" data-wm="flex" class="${when !== 'custom' ? 'on' : ''}">${IC.moon}Flexible</button></div>
        <div class="rc" id="dates" ${when === 'custom' ? '' : 'hidden'}>
          <div class="rc-sum" id="rc-sum"></div>
          <div class="rc-head"><button type="button" class="rc-nav" data-cal="-1" aria-label="Previous month">${ICON.back}</button><b id="rc-title"></b><button type="button" class="rc-nav fwd" data-cal="1" aria-label="Next month">${ICON.back}</button></div>
          <div class="rc-dow">${['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d) => `<span>${d}</span>`).join('')}</div>
          <div class="rc-grid" id="rc-grid"></div>
          <input type="hidden" id="dFrom" value="${f.dateFrom || ''}"><input type="hidden" id="dTo" value="${f.dateTo || ''}">
        </div>
        <div class="chips" id="when" ${when === 'custom' ? 'hidden' : ''}>${[['1', 'Within 1 month'], ['2', '2 months'], ['3', '3 months'], ['6', '6 months'], ['12', '12 months']].map(([v, l]) => `<button type="button" class="chip${when === v || (when === 'custom' && v === '3') ? ' on' : ''}" data-w="${v}">${l}</button>`).join('')}</div>
        <div class="hint" id="when-hint"></div></div>
      <div class="field" id="nights-field" ${f.trip === 'oneway' ? 'hidden' : ''}><span class="lbl">Trip length</span>
        <div class="tl-box">
          <div class="tl-val"><b id="tl-val"></b><span id="tl-sub"></span></div>
          <div class="dual" id="dual"><div class="dual-track"><i id="dual-fill"></i></div>
            <input type="range" id="minN" min="1" max="45" step="1" value="${Math.min(45, f.minNights)}" aria-label="Shortest trip in nights">
            <input type="range" id="maxN" min="1" max="45" step="1" value="${Math.min(45, f.maxNights)}" aria-label="Longest trip in nights"></div>
          <div class="chips tl-presets">${[[2, 4, 'Weekend'], [6, 9, '1 week'], [12, 16, '2 weeks'], [7, 21, '1–3 weeks'], [21, 35, '3–5 weeks']].map(([a, b, l]) => `<button type="button" class="chip" data-tl="${a}-${b}">${l}</button>`).join('')}</div>
        </div></div>
      <div class="field"><span class="lbl">Stops</span>${seg('maxStops', [[0, 'Direct'], [1, 'Max 1'], [-1, 'Any']], f.maxStops)}</div>
      <div class="field"><span class="lbl">Airlines</span>
        <div class="seg" id="air-mode"><button type="button" data-m="any">Any airline</button><button type="button" data-m="pick">Choose airlines</button></div>
        <div class="hint" id="air-hint"></div>
        <div class="al-box" id="al-box" hidden><input class="input al-search" id="air-q" placeholder="Search airlines" autocomplete="off"><div class="al-list" id="al-list"></div></div></div>
      <div class="field"><span class="lbl">Notify me about</span>${seg('alert', [['extreme', 'Only extreme'], ['great', 'Great +'], ['good', 'Every deal']], f.alert)}
        <div class="hint">A deal is a real price drop: the cheapest fare compared with the usual cheapest fare of the last 30 days. Extreme = 45% lower, great = 30%, good = 15%.</div>
        <input class="input" style="margin-top:10px" type="number" inputmode="numeric" id="maxPrice" placeholder="And always below € (optional), e.g. 450" value="${f.maxPrice || ''}"></div>
      <div class="sheet-foot"><p class="edit-sum" id="edit-sum"></p><button class="btn primary block" id="save">${w ? 'Save changes' : 'Start tracking'}</button></div>`, (sheet) => {
      const destBox = $('#dest-box', sheet);
      const renderDest = () => {
        if (f.dest) {
          const label = f.kind === 'country' ? `Anywhere in ${esc(f.city)}` : `${esc(f.city)} <span class="muted">${esc(f.dest)}${f.country ? ' · ' + esc(f.country) : ''}</span>`;
          destBox.innerHTML = `<div class="picked"><span>${label}</span><button type="button">Change</button></div>`;
          $('button', destBox).onclick = () => { f.dest = ''; renderDest(); loadAirlines(); $('#dest', sheet).focus(); };
          return;
        }
        destBox.innerHTML = `<input class="input" id="dest" placeholder="City, airport or country" autocomplete="off" autocapitalize="words"><div class="suggest" hidden></div>`;
        const input = $('#dest', destBox), box = $('.suggest', destBox);
        let timer;
        const pick = (b) => { clearTimeout(timer); Object.assign(f, { kind: b.dataset.kind, dest: b.dataset.code, city: b.dataset.city, country: b.dataset.country }); renderDest(); loadAirlines(); };
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

      // Airlines: "Any airline", or choose from the airlines that actually fly this route (cheapest first).
      const airHint = $('#air-hint', sheet), alBox = $('#al-box', sheet), alList = $('#al-list', sheet), airQ = $('#air-q', sheet);
      let mode = f.airlines.length ? 'pick' : 'any';
      let onRoute = null;      // null = not loaded yet, else [{code, name, price, count}]
      let loading = false, loadTimer, loadSeq = 0;
      const row = (c, price, count) => `<button type="button" class="al-row${f.airlines.includes(c) ? ' on' : ''}" data-al="${esc(c)}" role="checkbox" aria-checked="${f.airlines.includes(c)}">
          <i class="ck"></i>${airMark(c)}<span class="n">${esc(airlineName(c))}</span>${price ? `<span class="pr"><b class="num">${eur(price)}</b>${count ? `<small>${count} ${count > 1 ? 'fares' : 'fare'}</small>` : ''}</span>` : ''}</button>`;
      const renderAir = () => {
        $$('#air-mode button', sheet).forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
        alBox.hidden = mode !== 'pick';
        const n = onRoute ? onRoute.length : 0;
        airHint.textContent = mode === 'any'
          ? (!f.dest ? 'Every airline counts.' : loading ? 'Looking up which airlines fly here…' : n ? `${n} airlines fly this route. Every one counts.` : 'Every airline counts.')
          : f.airlines.length ? `${f.airlines.length} selected. Prices, the normal price and alerts only use ${f.airlines.length > 1 ? 'these airlines' : 'this airline'}.` : 'Tick the airlines you want to fly with.';
        if (mode !== 'pick') return;
        const t = airQ.value.trim().toLowerCase();
        const match = (c) => !t || airlineName(c).toLowerCase().includes(t) || c.toLowerCase() === t;
        if (!f.dest) { alList.innerHTML = '<p class="al-msg">Pick where you’re going first. Then you’ll see every airline that flies there.</p>'; return; }
        if (loading && !onRoute) { alList.innerHTML = '<div class="al-load"><span class="spin"></span>Finding airlines that fly here…</div>' + '<div class="al-skel"></div>'.repeat(4); return; }
        const list = (onRoute || []).filter((a) => match(a.code));
        const codes = new Set((onRoute || []).map((a) => a.code));
        const extra = f.airlines.filter((c) => !codes.has(c) && match(c));
        const others = t.length >= 2 ? Object.keys(window.AIRLINES || {}).filter((c) => !codes.has(c) && !f.airlines.includes(c) && match(c)).slice(0, 6) : [];
        alList.innerHTML =
          (list.length ? `<div class="al-sec">Fly this route <span>cheapest fare, next 2 months</span></div>${list.map((a) => row(a.code, a.price, a.count)).join('')}` : '')
          + (extra.length ? `<div class="al-sec">Also chosen</div>${extra.map((c) => row(c)).join('')}` : '')
          + (others.length ? `<div class="al-sec">Other airlines</div>${others.map((c) => row(c)).join('')}` : '')
          + (!list.length && !extra.length && !others.length ? `<p class="al-msg">${t ? 'No airline with that name.' : 'No airline data for this route yet. Search to add one.'}</p>` : '');
      };
      const loadAirlines = () => {
        clearTimeout(loadTimer);
        if (!f.dest || !f.origins.length) { onRoute = null; loading = false; renderAir(); return; }
        loading = true;
        renderAir();
        loadTimer = setTimeout(async () => {
          const seq = ++loadSeq;
          try {
            const r = await api('airlines', null, `&origins=${f.origins.join(',')}&kind=${f.kind}&dest=${encodeURIComponent(f.dest)}&trip=${f.trip}&stops=${f.maxStops}`);
            if (seq === loadSeq) onRoute = r.airlines;
          } catch { if (seq === loadSeq) onRoute = onRoute || []; }
          if (seq === loadSeq) { loading = false; renderAir(); }
        }, 350);
      };
      $('#air-mode', sheet).addEventListener('click', (e) => {
        const b = e.target.closest('[data-m]');
        if (!b) return;
        mode = b.dataset.m;
        if (mode === 'any') f.airlines = [];
        renderAir();
      });
      alList.addEventListener('click', (e) => {
        const b = e.target.closest('[data-al]');
        if (!b) return;
        const c = b.dataset.al;
        if (f.airlines.includes(c)) f.airlines = f.airlines.filter((x) => x !== c);
        else if (f.airlines.length >= 12) return toast('At most 12 airlines');
        else f.airlines = [...f.airlines, c];
        renderAir();
      });
      airQ.oninput = renderAir;
      renderAir();
      loadAirlines();

      $$('[data-o]', sheet).forEach((b) => (b.onclick = () => {
        b.classList.toggle('on');
        f.origins = $$('[data-o].on', sheet).map((x) => x.dataset.o);
        loadAirlines();
      }));
      // When: a range calendar (tap the first day, then the last), or a flexible "next N months".
      let flexWhen = when === 'custom' ? '3' : when;
      const iso = (d) => d.toISOString().slice(0, 10);
      const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
      const lastDay = addDays(today, 364);
      const dFrom = $('#dFrom', sheet), dTo = $('#dTo', sheet);
      let calView = (dFrom.value || today).slice(0, 7);
      const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
      const whenHint = () => {
        const h = $('#when-hint', sheet);
        if (when !== 'custom') { h.textContent = 'Leaving any day from today until then.'; return; }
        const a = dFrom.value, b = dTo.value;
        const span = a && b ? daysBetween(a, b) : 0;
        const minN = +$('#minN', sheet).value;
        h.classList.toggle('warn', !!(a && b && f.trip === 'return' && span < minN));
        h.textContent = !a ? 'Tap the first day you could leave.' : !b ? 'Now tap the last day you need to be back.'
          : f.trip === 'return' && span < minN ? `This window is ${span} ${span === 1 ? 'night' : 'nights'}, shorter than your shortest trip (${minN}). Pick a wider range or a shorter trip.`
          : f.trip === 'return' ? 'Your whole trip fits inside these dates: you leave on or after the first day and are back by the last.'
          : 'You leave on any day between these dates.';
      };
      const renderCal = () => {
        const [y, m] = calView.split('-').map(Number);
        const first = new Date(Date.UTC(y, m - 1, 1));
        const lead = (first.getUTCDay() + 6) % 7;
        const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const a = dFrom.value, b = dTo.value;
        let html = '<span></span>'.repeat(lead);
        for (let d = 1; d <= n; d++) {
          const s = `${calView}-${String(d).padStart(2, '0')}`;
          const off = s < today || s > lastDay;
          const cls = [off ? 'off' : '', s === today ? 'today' : '', s === a ? 'start' : '', s === b ? 'end' : '', a && b && s > a && s < b ? 'in' : ''].filter(Boolean).join(' ');
          html += `<button type="button" class="${cls}" data-d="${s}" ${off ? 'disabled' : ''}>${d}</button>`;
        }
        $('#rc-grid', sheet).innerHTML = html;
        $('#rc-title', sheet).textContent = `${MONTHS_LONG[m - 1]} ${y}`;
        $('[data-cal="-1"]', sheet).disabled = calView <= today.slice(0, 7);
        $('[data-cal="1"]', sheet).disabled = calView >= lastDay.slice(0, 7);
        $('#rc-sum', sheet).innerHTML = a && b
          ? `<span class="rc-d"><small>From</small><b>${weekday(a)} ${day(a)}</b></span><span class="rc-arrow">${IC.plane}</span><span class="rc-d"><small>Until</small><b>${weekday(b)} ${day(b)}</b></span><span class="rc-len">${daysBetween(a, b) + 1} days</span>`
          : `<span class="rc-d"><small>From</small><b class="${a ? '' : 'ph'}">${a ? `${weekday(a)} ${day(a)}` : 'Pick a day'}</b></span><span class="rc-arrow">${IC.plane}</span><span class="rc-d"><small>Until</small><b class="ph">${a ? 'Pick a day' : '–'}</b></span>`;
        whenHint();
      };
      $('#rc-grid', sheet).addEventListener('click', (e) => {
        const btn = e.target.closest('[data-d]');
        if (!btn) return;
        const s = btn.dataset.d;
        if (!dFrom.value || dTo.value || s < dFrom.value) { dFrom.value = s; dTo.value = ''; }
        else dTo.value = s;
        renderCal();
        updateSum();
      });
      $$('[data-cal]', sheet).forEach((b) => (b.onclick = () => {
        calView = iso(new Date(Date.UTC(+calView.slice(0, 4), +calView.slice(5) - 1 + +b.dataset.cal, 1))).slice(0, 7);
        renderCal();
      }));
      $$('[data-wm]', sheet).forEach((b) => (b.onclick = () => {
        when = b.dataset.wm === 'custom' ? 'custom' : flexWhen;
        $$('[data-wm]', sheet).forEach((x) => x.classList.toggle('on', x === b));
        $('#dates', sheet).hidden = when !== 'custom';
        $('#when', sheet).hidden = when === 'custom';
        whenHint();
      }));
      $$('[data-w]', sheet).forEach((b) => (b.onclick = () => {
        when = flexWhen = b.dataset.w;
        $$('[data-w]', sheet).forEach((x) => x.classList.toggle('on', x === b));
        whenHint();
      }));
      renderCal();

      // Trip length: one slider with two handles, plus quick picks.
      const minR = $('#minN', sheet), maxR = $('#maxN', sheet);
      const renderLen = (moved) => {
        let a = +minR.value, b = +maxR.value;
        if (a > b) { if (moved === minR) maxR.value = b = a; else minR.value = a = b; }
        const pct = (v) => ((v - 1) / 44) * 100;
        $('#dual-fill', sheet).style.cssText = `left:${pct(a)}%;right:${100 - pct(b)}%`;
        $('#tl-val', sheet).textContent = a === b ? `${a} ${a === 1 ? 'night' : 'nights'}` : `${a}–${b}${b === 45 ? '+' : ''} nights`;
        const wk = (n) => (n % 7 === 0 ? `${n / 7} ${n === 7 ? 'week' : 'weeks'}` : `${n + 1} days`);
        $('#tl-sub', sheet).textContent = a === b ? wk(a) : `${wk(a)} to ${wk(b)}${b === 45 ? ' or more' : ''}`;
        $$('[data-tl]', sheet).forEach((c) => c.classList.toggle('on', c.dataset.tl === `${a}-${b}`));
        whenHint();
      };
      minR.oninput = () => renderLen(minR);
      maxR.oninput = () => renderLen(maxR);
      $$('[data-tl]', sheet).forEach((c) => (c.onclick = () => {
        const [a, b] = c.dataset.tl.split('-');
        minR.value = a; maxR.value = b;
        renderLen();
        updateSum();
      }));
      renderLen();
      $$('[data-seg]', sheet).forEach((s) => $$('button', s).forEach((b) => (b.onclick = () => {
        $$('button', s).forEach((x) => x.classList.toggle('on', x === b));
        const v = b.dataset.v;
        f[s.dataset.seg] = /^-?\d+$/.test(v) ? +v : v;
        if (s.dataset.seg === 'trip') { $('#nights-field', sheet).hidden = v === 'oneway'; whenHint(); }
        if (s.dataset.seg === 'trip' || s.dataset.seg === 'maxStops') loadAirlines();
      })));
      // A plain-language summary of what will be tracked, kept up to date while you edit.
      const sumEl = $("#edit-sum", sheet);
      const updateSum = () => {
        const names = f.origins.map(originName);
        const from = names.length > 2 ? names.slice(0, -1).join(", ") + " or " + names[names.length - 1] : names.join(" or ");
        const to = !f.dest ? "…" : f.kind === "country" ? "anywhere in " + f.city : f.city;
        const minN = +$("#minN", sheet).value || 7, maxN = Math.max(minN, +$("#maxN", sheet).value || 21);
        const leaving = when === "custom" ? ($("#dFrom", sheet).value && $("#dTo", sheet).value ? (f.trip === "return" ? "away between " : "leaving between ") + day($("#dFrom", sheet).value) + " and " + day($("#dTo", sheet).value) : "on dates you pick")
          : "leaving in the next " + (when === "1" ? "month" : when + " months");
        const st = f.maxStops === 0 ? "direct flights only" : f.maxStops === 1 ? "max 1 stop" : "any number of stops";
        const al = f.airlines.length ? "only " + f.airlines.map(airlineName).join(", ") : "any airline";
        const lvl = { extreme: "extreme deals", great: "great deals", good: "every deal" }[f.alert];
        const mp = +$("#maxPrice", sheet).value;
        sumEl.innerHTML = "<b>" + (f.trip === "return" ? "Return trips" : "One-way flights") + "</b> from " + esc(from || "…") + " to <b>" + esc(to) + "</b>"
          + (f.trip === "return" ? ", " + (minN === maxN ? minN : minN + "–" + (maxN >= 45 ? "45+" : maxN)) + " nights" : "") + ", " + leaving + ", " + st + ", " + esc(al) + ". Alerts for " + lvl + (mp ? " or below " + eur(mp) : "") + ".";
      };
      sheet.addEventListener("input", updateSum);
      sheet.addEventListener("click", () => setTimeout(updateSum, 0));
      updateSum();
      $('#save', sheet).onclick = async (e) => {
        if (!f.origins.length) return toast('Pick at least one airport to fly from');
        if (!f.dest) return toast('Pick a destination', 'Type a city or country and tap it in the list.');
        f.minNights = +$('#minN', sheet).value || 7;
        f.maxNights = Math.max(f.minNights, +$('#maxN', sheet).value || 21);
        if (f.maxNights >= 45) f.maxNights = 90;   // the slider's last stop means "or longer"
        f.maxPrice = +$('#maxPrice', sheet).value || null;
        if (when === 'custom') {
          f.dateFrom = $('#dFrom', sheet).value; f.dateTo = $('#dTo', sheet).value;
          if (!f.dateFrom || !f.dateTo) return toast('Pick your dates', 'Tap the first day you could leave, then the last day you need to be back.');
          if (f.trip === 'return' && daysBetween(f.dateFrom, f.dateTo) < f.minNights) return toast('Those dates are too close together', 'Pick a wider range or a shorter trip.');
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

  const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Prices count up to their value once, quickly, when a screen opens (skipped for reduced motion). */
  function countUp(root = view) {
    if (calm()) return;
    $$('.dh-big .num, .route-price .p', root).forEach((el) => {
      const to = parseInt(el.textContent.replace(/[^\d]/g, ''), 10);
      if (!to || el.dataset.counted) return;
      el.dataset.counted = '1';
      const from = Math.round(to * 0.82), t0 = performance.now(), dur = 520;
      const step = (now) => {
        const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
        el.textContent = eur(Math.round(from + (to - from) * e));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  }

  let depth = 0;
  async function render() {
    const m = location.hash.match(/^#\/route\/(\d+)/);
    window.scrollTo(0, 0);
    view.classList.remove('still');
    clearTimeout(pollTimer);
    // Slide in the direction of travel: deeper screens from the right, back from the left.
    const d = m ? 1 : 0;
    view.classList.remove('nav-fwd', 'nav-back');
    if (d !== depth && !calm()) { void view.offsetWidth; view.classList.add(d > depth ? 'nav-fwd' : 'nav-back'); }
    depth = d;
    if (m) { await route(+m[1]); countUp(); return; }
    home();
    countUp();
  }

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-more],[data-add],[data-edit],[data-copy],[data-howdeals],[data-sort],[data-scan],[data-pause],[data-delete],[data-fare],[data-back],[data-month],[data-day],[data-range] button,[data-allfares],[data-air],[data-tab]');
    if (!t) return;
    if (t.matches('[data-tab]')) {
      const k = t.dataset.tab;
      try { sessionStorage.setItem('fl-tab', k); } catch { /* private mode */ }
      $$('[data-tab]').forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-selected', b === t); });
      $$('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== k; });
      return;
    }
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
    if (t.matches('[data-copy]')) return editSheet(null, routeData.watch);
    if (t.matches('[data-howdeals]')) return howDeals();
    if (t.matches('[data-sort]')) { try { localStorage.setItem('fl-sort', t.dataset.sort); } catch { /* private mode */ } home(false); return; }
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
          const label = $('span', t) || t, was = label.textContent;
          t.dataset.sure = '1';
          label.textContent = 'Tap again to delete';
          setTimeout(() => { delete t.dataset.sure; label.textContent = was; }, 3000);
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
