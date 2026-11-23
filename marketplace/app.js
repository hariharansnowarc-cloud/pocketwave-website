// Pocketwave Marketplace: one page for advertisers and admins.
// Security: everything is decided in the database. Each call below goes to a database function that
// checks who is signed in (admin, approved advertiser, or nobody) and refuses anything else. This page
// only shows what those functions return. Text from the database is always inserted as plain text.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.1/+esm';

// ---- Don't run inside someone else's page (clickjacking). ----
if (window.top !== window.self) {
  document.body.textContent = 'This page cannot be shown inside another website.';
  throw new Error('framed');
}
document.body.classList.remove('framed-guard');

// Public project address and anon key (safe to be public; the app contains them too).
const SUPABASE_URL = 'https://cvgfksrlwbrstkgzpowt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2Z2Zrc3Jsd2Jyc3RrZ3pwb3d0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUwNjI5NTcsImV4cCI6MjExMDYzODk1N30.HzaLdwXWm1HIHgDKUfdorZM11mg4ZItdAO6VIWiB2iM';

// Session lives only in this browser tab: closing the tab signs you out.
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const ROWS = { national: 'National', regional: 'Regional (state)', local: 'Near you (town)' };
const ROW_SHORT = { national: 'National', regional: 'Regional', local: 'Near you' };
const IDLE_MINUTES = 60;
const $ = (id) => document.getElementById(id);
const root = $('root');
let me = null; // market_whoami()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'value') e.value = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(tag, attrs = {}, ...kids) {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const k of kids.flat(Infinity)) if (k != null && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return e;
}
/** Like replaceChildren, but skips empty values (null, false) instead of printing "null". */
function fill(target, ...kids) {
  target.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
}
function toast(msg, bad = false) {
  const t = $('toast');
  t.textContent = msg;
  t.className = bad ? 'bad' : '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.add('hidden'), 4000);
}
const inr = (n) => (n == null ? '–' : '₹' + Number(n).toLocaleString('en-IN'));
const num = (n) => (n == null ? '–' : Number(n).toLocaleString('en-IN'));
const plural = (n, word) => `${num(n)} ${word}${Number(n) === 1 ? '' : 's'}`;
const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '–');
const indiaToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10);
const when = (iso) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const dayLabel = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const dayLong = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const safeImg = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);
const where = (r) => (r.row_kind === 'national' ? '🇮🇳 National' : r.row_kind === 'regional' ? `🗺️ ${r.state}` : `📍 ${r.city ?? 'Town'}, ${r.state}`);
const badge = (text, kind = '') => el('span', { class: 'badge ' + kind }, text);
const empty = (text, icon = '📭') => el('div', { class: 'empty' }, el('div', { class: 'icon' }, icon), el('p', {}, text));
const note = (text, kind = '', icon = 'ℹ️') => el('div', { class: 'note ' + kind }, el('span', {}, icon), el('div', {}, text));
function card(title, sub, ...kids) {
  return el('div', { class: 'card' }, title ? el('h3', {}, title) : null, sub ? el('p', { class: 'sub' }, sub) : null, ...kids);
}

const ERRORS = {
  not_allowed: 'Not allowed.',
  not_authenticated: 'Please sign in again.',
  not_registered: 'Register your business first.',
  advertiser_not_approved: 'Your business account is not approved yet.',
  already_registered: 'This Google account is already registered.',
  accept_policy: 'Please accept the advertising rules.',
  signup_closed: 'New sign-ups are closed for now. Write to us.',
  state_unknown: 'Pick a state from the list.',
  place_unknown: 'Pick a town or district from the list.',
  place_exists: 'That place is already in the list.',
  city_invalid: 'Enter a city name (letters only).',
  picture_not_allowed: 'Upload pictures with the button; links to other sites are not allowed.',
  too_many_ads: 'You have the most ads allowed. Delete an old one first.',
  rate_limited_market: 'Too many changes in a short time. Try again later.',
  ad_not_found: 'Ad not found.',
  ad_in_use: 'This ad has upcoming spots or open bids, so it can\'t be deleted.',
  ad_not_approved: 'Choose one of your approved ads.',
  bidding_closed: 'Bidding is not open yet.',
  bidding_deadline_passed: 'Bidding for that day has closed.',
  bidding_too_far: 'You can bid up to 60 days ahead.',
  bid_below_minimum: 'Your bid is below the minimum price for that row.',
  bid_too_high: 'That amount is too high.',
  bid_not_found: 'Bid not found.',
  spot_taken: 'That spot is already booked for that day.',
  range_invalid: 'Choose a valid date range (up to about a year).',
  admin_market_dashboard: 'The dashboard SQL hasn\'t been run yet (20261123160000_market_dashboard.sql).',
  admin_app_dashboard: 'The dashboard SQL hasn\'t been run yet (20261123160000_market_dashboard.sql).',
  market_bookings_slot_idx: 'That spot is already booked for that day.',
  market_ads_check1: 'Website links must start with https://',
  market_ads_check: 'This button needs a value (link, phone, code or place).',
  market_advertisers_phone_check: 'Enter a valid phone number.',
  market_advertisers_gst_check: 'GST number looks wrong (15 characters).',
  market_advertisers_website_check: 'Website must start with https://',
  market_bookings_check: 'Regional needs a state; Near you needs a town or district.',
  market_bids_check: 'Regional needs a state; Near you needs a town or district.',
};
function errText(e) {
  const m = e?.message || String(e);
  for (const [k, v] of Object.entries(ERRORS)) if (m.includes(k)) return v;
  return 'Something went wrong. ' + m.slice(0, 160);
}
async function rpc(name, args) {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw error;
  return data;
}
async function act(name, args, after, okMsg = 'Saved') {
  try {
    const r = await rpc(name, args);
    toast(okMsg);
    await after?.(r);
    return r;
  } catch (e) {
    toast(errText(e), true);
  }
}
function field(label, input, cls = '') { return el('div', { class: 'field ' + cls }, el('label', {}, label), input); }
function stateSelect(value, blank = '— choose —') {
  return el('select', {}, el('option', { value: '' }, blank), (me?.states ?? []).map((s) => el('option', { value: s, selected: s === value }, s)));
}
function setStatus(text) { $('status').textContent = text ?? ''; $('status').classList.toggle('hidden', !text); }

/** Tabs: [{ key, label, render(container) }] */
const hashParts = () => decodeURIComponent(location.hash.slice(1)).split('/');
function setHash(...parts) { history.replaceState(null, '', '#' + parts.filter(Boolean).join('/')); }
function tabs(list, start, { sub = false, onOpen, hash = false } = {}) {
  const bar = el('div', { class: 'tabs' + (sub ? ' sub' : ''), role: 'tablist' });
  const body = el('div');
  const open = (t) => {
    [...bar.children].forEach((b) => { const on = b.dataset.key === t.key; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    onOpen?.(t.key);
    if (hash && hashParts()[0] !== t.key) setHash(t.key);
    fill(body, el('p', { class: 'small' }, 'Loading…'));
    Promise.resolve(t.render(body)).catch((e) => fill(body, note(errText(e), 'bad', '⚠️')));
  };
  list.forEach((t) => bar.append(el('button', { 'data-key': t.key, role: 'tab', onclick: () => open(t) }, t.label)));
  open((hash && list.find((t) => t.key === hashParts()[0])) || list.find((t) => t.key === start) || list[0]);
  return [bar, body];
}

/** Sortable table with "show more" and CSV download.
 *  cols: [{ key, label, num?, fmt?(v,row), get?(row), csv?(row) }] */
function dataTable(cols, rows, { csv, limit = 50, sortKey, sortDir = -1, emptyText = 'Nothing here for these filters.' } = {}) {
  if (!rows?.length) return empty(emptyText);
  const wrap = el('div');
  let key = sortKey, dir = sortDir, showAll = false;
  const val = (c, r) => (c.get ? c.get(r) : r[c.key]);
  const render = () => {
    const sorted = key ? [...rows].sort((a, b) => {
      const c = cols.find((x) => x.key === key);
      const va = val(c, a), vb = val(c, b);
      if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * dir;
    }) : rows;
    const shown = showAll ? sorted : sorted.slice(0, limit);
    fill(wrap,
      el('div', { class: 'table-wrap' }, el('table', {},
        el('thead', {}, el('tr', {}, cols.map((c) => el('th', { class: 'sortable' + (c.num ? ' num' : ''), onclick: () => { dir = key === c.key ? -dir : (c.num ? -1 : 1); key = c.key; render(); } },
          c.label, key === c.key ? (dir > 0 ? ' ▲' : ' ▼') : '')))),
        el('tbody', {}, shown.map((r) => el('tr', {}, cols.map((c) => {
          const v = val(c, r);
          const out = c.fmt ? c.fmt(v, r) : v ?? '–';
          return el('td', { class: c.num ? 'num' : '' }, out instanceof Node ? out : String(out));
        })))))),
      el('div', { class: 'table-tools' },
        el('span', { class: 'grow' }, `${shown.length} of ${rows.length}`),
        rows.length > limit ? el('button', { class: 'ghost small', onclick: () => { showAll = !showAll; render(); } }, showAll ? 'Show less' : `Show all ${rows.length}`) : null,
        csv ? el('button', { class: 'ghost small', onclick: () => downloadCsv(csv, cols, sorted) }, '⬇ CSV') : null));
  };
  render();
  return wrap;
}
function downloadCsv(name, cols, rows) {
  // Cells starting with = + - @ could run as formulas in Excel: prefix them with '.
  const cell = (v) => {
    let s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const lines = [cols.map((c) => cell(c.label)).join(','), ...rows.map((r) => cols.map((c) => cell(c.csv ? c.csv(r) : c.get ? c.get(r) : r[c.key])).join(','))];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = el('a', { href: url, download: `pocketwave-${name}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Signs out after an hour without activity.
let lastActive = Date.now();
['click', 'keydown', 'mousemove', 'touchstart', 'scroll'].forEach((ev) => addEventListener(ev, () => (lastActive = Date.now()), { passive: true }));
setInterval(async () => {
  if (me && Date.now() - lastActive > IDLE_MINUTES * 60e3) {
    await sb.auth.signOut();
    location.reload();
  }
}, 60e3);

// ---------------------------------------------------------------------------
// Charts (plain SVG, no outside library)
// ---------------------------------------------------------------------------

const tip = $('viz-tip');
function showTip(ev, ...lines) {
  fill(tip, lines.filter((l) => l != null).map((l) => el('div', {}, l)));
  tip.classList.remove('hidden');
  const x = Math.min(ev.clientX + 14, innerWidth - tip.offsetWidth - 8);
  const y = ev.clientY - tip.offsetHeight - 12 < 0 ? ev.clientY + 16 : ev.clientY - tip.offsetHeight - 12;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
}
const hideTip = () => tip.classList.add('hidden');
/** Top of the y-axis: 4 even steps of a round number (1, 2, 2.5 or 5 × 10ⁿ). */
function niceMax(v) {
  if (!(v > 0)) return 4;
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  return 4 * [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= raw);
}
const shortNum = (n) => (n >= 1e7 ? (n / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr' : n >= 1e5 ? (n / 1e5).toFixed(1).replace(/\.0$/, '') + 'L' : n >= 1e3 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

/** Column chart over days. series: [{ key, name, color }] (stacked when more than one). */
function columnChart(data, series, { fmt = num, label = (d) => dayLabel(d.day), title = (d) => dayLong(d.day), wide = false } = {}) {
  const W = wide ? 1080 : 540, H = wide ? 260 : 240, L = 46, R = 8, T = 10, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const totals = data.map((d) => series.reduce((s, x) => s + Number(d[x.key] || 0), 0));
  const max = niceMax(Math.max(...totals, 0));
  const step = pw / Math.max(data.length, 1);
  const bw = Math.max(1.5, Math.min(40, step - 2));
  const y = (v) => T + ph - (v / max) * ph;
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i ? 'gridline' : 'baseline' }),
      svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, shortNum(v)));
  }
  const every = Math.max(1, Math.ceil(data.length / (wide ? 12 : 6)));
  data.forEach((d, i) => {
    const x = L + i * step + (step - bw) / 2;
    let acc = 0;
    const top = series.map((s) => Number(d[s.key] || 0)).reduce((last, v, j) => (v > 0 ? j : last), -1);
    series.forEach((s, j) => {
      const v = Number(d[s.key] || 0);
      if (v <= 0) return;
      const y0 = y(acc), y1 = y(acc + v);
      const h = Math.max(0, y0 - y1 - (j > 0 ? 2 : 0));
      const r = j === top ? Math.min(4, bw / 2, h) : 0;
      const yb = j > 0 ? y0 - 2 : y0;
      g.append(svg('path', { class: 'bar', fill: s.color, d: `M${x},${yb} V${yb - h + r} Q${x},${yb - h} ${x + r},${yb - h} H${x + bw - r} Q${x + bw},${yb - h} ${x + bw},${yb - h + r} V${yb} Z` }));
      acc += v;
    });
    if (i % every === 0) g.append(svg('text', { x: x + bw / 2, y: H - 8, 'text-anchor': 'middle' }, label(d)));
    const hit = svg('rect', { x: L + i * step, y: T, width: step, height: ph, class: 'hit', tabindex: -1 });
    hit.addEventListener('pointermove', (ev) => showTip(ev, el('strong', {}, title(d)),
      ...series.map((s) => `${series.length > 1 ? s.name + ': ' : ''}${fmt(Number(d[s.key] || 0))}`), series.length > 1 ? `Total: ${fmt(totals[i])}` : null));
    hit.addEventListener('pointerleave', hideTip);
    g.append(hit);
  });
  const wrap = el('div', {});
  if (series.length > 1) wrap.append(el('div', { class: 'legend' }, series.map((s) => el('span', { style: `--c:${s.color}` }, s.name))));
  wrap.append(g);
  return wrap;
}

/** Line chart over days with a crosshair. */
function lineChart(data, key, { fmt = num, color = 'var(--s1)', name = '', wide = false } = {}) {
  const W = wide ? 1080 : 540, H = wide ? 240 : 220, L = 46, R = 12, T = 12, B = 26;
  const pw = W - L - R, ph = H - T - B;
  const vals = data.map((d) => Number(d[key] || 0));
  const max = niceMax(Math.max(...vals, 0));
  const x = (i) => L + (data.length > 1 ? (i / (data.length - 1)) * pw : pw / 2);
  const y = (v) => T + ph - (v / max) * ph;
  const g = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img' });
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    g.append(svg('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: i ? 'gridline' : 'baseline' }),
      svg('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end' }, shortNum(v)));
  }
  const every = Math.max(1, Math.ceil(data.length / (wide ? 12 : 6)));
  data.forEach((d, i) => { if (i % every === 0) g.append(svg('text', { x: x(i), y: H - 8, 'text-anchor': 'middle' }, dayLabel(d.day))); });
  g.append(svg('path', { d: vals.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join(' '), fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
  const cross = svg('line', { y1: T, y2: T + ph, stroke: 'var(--muted)', 'stroke-width': 1, 'stroke-dasharray': '3 3', visibility: 'hidden' });
  const dot = svg('circle', { r: 5, fill: color, stroke: 'var(--bg)', 'stroke-width': 2, visibility: 'hidden' });
  const hit = svg('rect', { x: L, y: T, width: pw, height: ph, class: 'hit' });
  hit.addEventListener('pointermove', (ev) => {
    const box = g.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(data.length - 1, Math.round(((px - L) / pw) * (data.length - 1))));
    cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(vals[i])); dot.setAttribute('visibility', 'visible');
    showTip(ev, el('strong', {}, fmt(vals[i])), `${name ? name + ' · ' : ''}${dayLong(data[i].day)}`);
  });
  hit.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); hideTip(); });
  g.append(cross, dot, hit);
  return g;
}

/** Horizontal bars (rankings): items [{ name, value }] */
function hbars(items, { fmt = num, max = 10, zeros = false } = {}) {
  const list = items.filter((i) => zeros || Number(i.value) > 0).slice(0, max);
  if (!list.some((i) => Number(i.value) > 0)) return empty('No data yet.', '📊');
  const top = Math.max(...list.map((i) => Number(i.value)));
  return el('div', { class: 'hbar' }, list.map((i) => [
    el('div', { class: 'name', title: i.name }, i.name),
    el('div', { class: 'track' }, Number(i.value) > 0 ? el('div', { class: 'fill', style: `width:${(Number(i.value) / top) * 100}%` }) : null),
    el('div', { class: 'val' }, fmt(i.value)),
  ]));
}
function kpi(label, value, hint, onclick) {
  return el('div', { class: 'kpi' + (onclick ? ' click' : ''), onclick }, el('div', { class: 'label' }, label), el('div', { class: 'value' }, value), hint ? el('div', { class: 'hint' }, hint) : null);
}
function chartCard(title, sub, chart) { return el('div', { class: 'card' }, el('h3', {}, title), sub ? el('p', { class: 'sub' }, sub) : null, chart); }

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

let shownFor = null; // user id the page was last built for
async function main() {
  const { data: { session } } = await sb.auth.getSession();
  shownFor = session?.user?.id ?? null;
  if (!session) return landing();
  try {
    me = await rpc('market_whoami');
  } catch (e) {
    setStatus('');
    fill(root, card('Can\'t open the Marketplace', null, note(errText(e), 'bad', '⚠️'),
      el('p', { class: 'small' }, 'If you are the owner: check that the Market SQL has been run in Supabase.'), el('div', { class: 'actions' }, signOutBtn())));
    return;
  }
  if (me.contact_email) { $('contactLink').textContent = me.contact_email; $('contactLink').href = 'mailto:' + me.contact_email; }
  setStatus('');
  const top = el('div', { class: 'topbar' },
    el('h1', {}, me.is_admin ? 'Marketplace admin' : me.advertiser?.status === 'approved' ? me.advertiser.business_name : 'Marketplace'),
    el('div', { class: 'who' }, el('strong', {}, me.is_admin ? 'Admin' : me.advertiser?.status === 'approved' ? 'Approved advertiser' : 'Advertiser'), me.email ?? ''),
    signOutBtn());
  let view;
  if (me.is_admin) view = adminView();
  else if (!me.advertiser) view = registerView();
  else if (me.advertiser.status === 'approved') view = advertiserView();
  else view = waitingView();
  fill(root, top, ...[view].flat());
}

function signOutBtn() {
  return el('button', { class: 'secondary small', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out');
}

let started = false;
async function start() {
  if (started) return;
  started = true;
  await main();
}
// Supabase reports SIGNED_IN again whenever you come back to this browser tab. Only rebuild the
// page when a different person signed in (or someone signed in on the landing page).
sb.auth.onAuthStateChange((ev, session) => {
  if (ev === 'SIGNED_IN' && session?.user?.id && session.user.id !== shownFor) { started = false; start(); }
  if (ev === 'SIGNED_OUT' && shownFor) location.reload();
});
start();

// ---------------------------------------------------------------------------
// Signed out: what this is and how it works
// ---------------------------------------------------------------------------

function signInGoogle() { sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/marketplace/' } }); }

function landing() {
  setStatus('');
  const feature = (icon, title, text) => el('div', { class: 'feature' }, el('div', { class: 'icon' }, icon), el('h3', {}, title), el('p', {}, text));
  fill(root,
    el('div', { class: 'hero' },
      el('h1', {}, 'Advertise on Pocketwave'),
      el('p', {}, 'Pocketwave has a Market tab with a small set of hand-picked offers each day. People open it because they want to see today\'s deals. No ads in chats, no tracking, no clutter.'),
      el('button', { class: 'big', onclick: signInGoogle }, 'Continue with Google'),
      el('p', { class: 'hint' }, 'Pocketwave admins sign in here too.'),
      el('div', { class: 'hero-stats' },
        el('div', {}, el('strong', {}, '3 rows'), 'National · State · Town'),
        el('div', {}, el('strong', {}, '10 spots'), 'in each row'),
        el('div', {}, el('strong', {}, 'Daily'), 'fresh at midnight IST'))),
    el('div', { class: 'feature-grid' },
      feature('🇮🇳', 'National', 'Seen by everyone in India who opens Market that day.'),
      feature('🗺️', 'Regional', 'Seen by people in one state.'),
      feature('📍', 'Near you', 'Seen by people in one town or district.')),
    card('How it works', 'Spot #1 is seen first and is worth the most.',
      el('ol', { class: 'steps' },
        el('li', {}, el('strong', {}, 'Register. '), 'Sign in with Google and tell us about your business. We check every business before it can advertise.'),
        el('li', {}, el('strong', {}, 'Create your ad. '), 'A picture, your offer and a button: website, call, coupon code or directions. We review each ad.'),
        el('li', {}, el('strong', {}, 'Place a sealed bid. '), 'Pick a day and a row. Nobody sees your bid. Bidding closes at 6 PM India time the day before.'),
        el('li', {}, el('strong', {}, 'Win a spot. '), 'The highest bid gets #1, the next gets #2, and so on. You pay ₹1 more than the bid below yours, never more than you offered.'),
        el('li', {}, el('strong', {}, 'See results. '), 'Views and taps for your ad after your day.'))),
    card('What we don\'t accept', null,
      el('p', { class: 'small', style: 'margin:0' }, 'Betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, and misleading offers.')));
}

// ---------------------------------------------------------------------------
// Advertiser: register, waiting, main
// ---------------------------------------------------------------------------

function businessForm(a, { register }) {
  const f = {
    business_name: el('input', { maxlength: 80, value: a?.business_name ?? '', disabled: a && a.status === 'approved' }),
    contact_name: el('input', { maxlength: 60, value: a?.contact_name ?? '' }),
    phone: el('input', { maxlength: 16, value: a?.phone ?? '', placeholder: '+91 98400 00000', inputmode: 'tel' }),
    gst: el('input', { maxlength: 15, value: a?.gst ?? '', placeholder: 'Optional', disabled: a && a.status === 'approved' }),
    website: el('input', { value: a?.website ?? '', placeholder: 'https://… (optional)', inputmode: 'url' }),
    address: el('input', { maxlength: 200, value: a?.address ?? '' }),
    state: stateSelect(a?.state),
    city: el('input', { maxlength: 40, value: a?.city ?? '' }),
  };
  const accept = el('input', { type: 'checkbox' });
  const save = el('button', {}, register ? 'Register business' : 'Save details');
  save.onclick = async () => {
    const p = Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim()]));
    if (!p.business_name || !p.contact_name || !p.phone) return toast('Business name, contact name and phone are needed', true);
    save.disabled = true;
    if (register) {
      p.accept_policy = accept.checked;
      await act('market_adv_register', { p }, main, 'Registered. We\'ll review your business soon.');
    } else {
      await act('market_adv_update', { p }, main);
    }
    save.disabled = false;
  };
  return card(register ? 'Register your business' : 'Business details',
    a?.status === 'approved' ? 'Business name and GST can\'t be changed after approval. Write to us if they need fixing.' : 'Fields with * are needed.',
    el('div', { class: 'grid' },
      field('Business name *', f.business_name), field('Contact person *', f.contact_name), field('Phone *', f.phone),
      field('GST number', f.gst), field('Website', f.website), field('Address', f.address), field('State', f.state), field('City', f.city)),
    register ? el('label', { class: 'check' }, accept,
      el('span', {}, 'My business and ads follow the rules: no betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, or misleading offers. I accept the ', el('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Terms'), '.')) : null,
    el('div', { class: 'actions' }, save));
}

function registerView() {
  if (!me.signup_open) return note('New advertiser sign-ups are closed for now. Write to us at ' + me.contact_email + '.', 'warn', '⏸️');
  return [note('Welcome! Tell us about your business. We\'ll check it and approve your account, usually within a day.', '', '👋'), businessForm(null, { register: true })];
}

function waitingView() {
  const a = me.advertiser;
  const msg = {
    pending: ['⏳', 'We\'re reviewing your business', 'You\'ll be able to create ads and bid once approved. Keep your details up to date below.', 'warn'],
    rejected: ['✋', 'Your registration wasn\'t approved', 'Fix your details below and save to send it again.', 'bad'],
    suspended: ['⛔', 'Your account is suspended', 'Write to us if you think this is a mistake.', 'bad'],
  }[a.status] ?? ['', '', '', ''];
  return [
    el('div', { class: 'note ' + msg[3] }, el('span', {}, msg[0]), el('div', {}, el('strong', {}, msg[1]), el('div', {}, msg[2]),
      a.admin_note ? el('div', { class: 'small', style: 'margin-top:4px' }, 'Note from us: ' + a.admin_note) : null)),
    a.status === 'suspended' ? null : businessForm(a, { register: false }),
  ];
}

function advertiserView() {
  return tabs([
    { key: 'bid', label: '🏷️ Bid for a spot', render: advBid },
    { key: 'ads', label: '🖼️ My ads', render: advAds },
    { key: 'bids', label: '📨 My bids', render: advBids },
    { key: 'results', label: '📈 Results', render: advResults },
    { key: 'account', label: '🏢 Account', render: (c) => fill(c, businessForm(me.advertiser, { register: false })) },
  ], 'bid', { hash: true });
}

// ---- Ads (shared form for advertisers and admins) ----

const ACTIONS = { none: 'No button', link: 'Visit website', call: 'Call', code: 'Copy coupon code', directions: 'Directions' };
const VALUE_HINT = { none: '', link: 'https://…', call: 'Phone number', code: 'Coupon code', directions: 'Place or address' };

async function uploadPicture(file, folder) {
  if (!file) return null;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP picture');
  if (file.size > 2 * 1024 * 1024) throw new Error('Picture is over 2 MB');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type];
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from('market').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return sb.storage.from('market').getPublicUrl(path).data.publicUrl;
}

function adForm({ ad, admin, onSaved }) {
  const f = {
    advertiser: el('input', { maxlength: 60, value: ad?.advertiser ?? '' }),
    title: el('input', { maxlength: 60, value: ad?.title ?? '' }),
    offer: el('textarea', { maxlength: 200 }),
    category: el('input', { maxlength: 30, value: ad?.category ?? '', placeholder: 'Food, Education…' }),
    action: el('select', {}, Object.entries(ACTIONS).map(([k, v]) => el('option', { value: k, selected: (ad?.action ?? 'none') === k }, v))),
    action_value: el('input', { value: ad?.action_value ?? '' }),
    action_label: el('input', { maxlength: 20, value: ad?.action_label ?? '', placeholder: 'Order now (optional)' }),
    contact: el('input', { value: ad?.contact ?? '' }),
  };
  f.offer.value = ad?.offer ?? '';
  f.action_value.placeholder = VALUE_HINT[f.action.value];
  f.action.onchange = () => (f.action_value.placeholder = VALUE_HINT[f.action.value]);
  let imageUrl = ad?.image_url ?? '';
  let logoUrl = ad?.logo_url ?? '';
  const imgFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const logoFile = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  const preview = el('div', { class: 'row' }, safeImg(imageUrl) ? el('img', { class: 'thumb', src: imageUrl, alt: '' }) : null);
  imgFile.onchange = () => {
    const file = imgFile.files[0];
    if (file && file.type.startsWith('image/')) fill(preview, el('img', { class: 'thumb', src: URL.createObjectURL(file), alt: '' }), el('span', { class: 'small' }, 'New picture (uploads when you save)'));
  };
  const approved = el('input', { type: 'checkbox', checked: ad?.approved });
  const save = el('button', {}, ad ? 'Save changes' : 'Create ad');
  save.onclick = async () => {
    if (!f.title.value.trim() || (admin && !f.advertiser.value.trim())) return toast(admin ? 'Advertiser and title are needed' : 'Title is needed', true);
    save.disabled = true;
    try {
      const folder = admin ? 'ads' : `adv/${me.advertiser.id}`;
      imageUrl = (await uploadPicture(imgFile.files[0], folder)) ?? imageUrl;
      logoUrl = (await uploadPicture(logoFile.files[0], folder)) ?? logoUrl;
      const p = {
        id: ad?.id ?? null, title: f.title.value.trim(), offer: f.offer.value.trim(), category: f.category.value.trim(),
        action: f.action.value, action_value: f.action_value.value.trim(), action_label: f.action_label.value.trim(),
        image_url: imageUrl, logo_url: logoUrl,
      };
      if (admin) Object.assign(p, { advertiser: f.advertiser.value.trim(), contact: f.contact.value.trim(), approved: approved.checked });
      await rpc(admin ? 'admin_market_save_ad' : 'market_adv_save_ad', { p });
      toast(admin ? 'Ad saved' : 'Saved. We\'ll review it before it can be used.');
      onSaved?.();
    } catch (e) {
      toast(errText(e), true);
    } finally {
      save.disabled = false;
    }
  };
  return card(ad ? 'Edit ad' : 'New ad', 'Not allowed: betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, misleading offers.',
    !admin && ad ? note('Saving any change sends the ad back for review.', 'warn', '🔁') : null,
    el('div', { class: 'grid' },
      admin ? field('Advertiser *', f.advertiser) : null, field('Title *', f.title), field('Category', f.category),
      admin ? field('Advertiser contact (only admins see this)', f.contact) : null),
    field('Offer text (up to 200 letters)', f.offer),
    el('div', { class: 'grid' }, field('Button', f.action), field('Button value', f.action_value), field('Button text', f.action_label)),
    el('div', { class: 'grid' }, field('Picture (16:9, JPG/PNG/WebP, under 2 MB)', imgFile), field('Logo (square, optional)', logoFile)),
    preview,
    admin ? el('label', { class: 'check' }, approved, el('span', {}, 'Approved (only approved ads are shown or can bid)')) : null,
    el('div', { class: 'actions' }, save, onSaved && ad ? el('button', { class: 'secondary', onclick: onSaved }, 'Cancel') : null));
}

function adCard(a, buttons) {
  return el('div', { class: 'card' },
    el('div', { class: 'list-item' },
      safeImg(a.image_url) ? el('img', { class: 'thumb', src: a.image_url, alt: '' }) : el('div', { class: 'thumb' }),
      el('div', { class: 'main' },
        el('div', { class: 'row' }, el('span', { class: 'title grow' }, a.title), a.approved ? badge('Approved', 'ok') : badge('Waiting for review', 'warn')),
        el('div', { class: 'meta-line' }, [a.advertiser, a.category, ACTIONS[a.action] + (a.action_value ? ': ' + a.action_value : '')].filter(Boolean).join(' · ')),
        a.offer ? el('div', { class: 'small', style: 'margin-top:4px' }, a.offer) : null,
        el('div', { class: 'meta-line' }, `👁 ${num(a.views ?? 0)} views · 👆 ${num(a.taps ?? 0)} taps`),
        a.review_note ? el('div', { class: 'small bad', style: 'margin-top:4px' }, 'Review note: ' + a.review_note) : null,
        el('div', { class: 'actions' }, buttons))));
}

async function advAds(c) {
  const ads = await rpc('market_adv_ads');
  const formBox = el('div');
  const showForm = (ad) => { fill(formBox, adForm({ ad, admin: false, onSaved: () => advAds(c) })); formBox.scrollIntoView({ behavior: 'smooth' }); };
  fill(c,
    ads.length ? ads.map((a) => adCard(a, [
      el('button', { class: 'secondary small', onclick: () => showForm(a) }, 'Edit'),
      el('button', { class: 'danger small', onclick: () => confirm('Delete this ad?') && act('market_adv_delete_ad', { p_id: a.id }, () => advAds(c), 'Deleted') }, 'Delete'),
    ])) : empty('No ads yet. Create your first one below.', '🖼️'),
    formBox);
  fill(formBox, adForm({ ad: null, admin: false, onSaved: () => advAds(c) }));
}

// ---- Bidding ----

// Row + state + town/district pickers (towns and districts come from the database list).
const placeCache = {};
async function placesFor(state) {
  if (!state) return [];
  placeCache[state] ??= rpc('market_places_list', { p_state: state }).catch(() => []);
  return placeCache[state];
}
function placeOptionLabel(p) { return p.kind === 'district' ? `${p.name} district` : `   ${p.name} (${p.district})`; }

function regionInputs(onChange) {
  const row = el('select', {}, Object.entries(ROWS).map(([k, v]) => el('option', { value: k }, v)));
  const state = stateSelect(me.advertiser?.state);
  const place = el('select', {}, el('option', { value: '' }, 'Choose a state first'));
  const stateBox = field('State', state);
  const placeBox = field('Town or district', place);
  const loadPlaces = async () => {
    fill(place, el('option', { value: '' }, state.value ? 'Loading…' : 'Choose a state first'));
    const list = await placesFor(state.value);
    fill(place, el('option', { value: '' }, list.length ? '— choose —' : 'No places'), list.map((p) => el('option', { value: p.id }, placeOptionLabel(p))));
    onChange?.();
  };
  const toggle = () => { stateBox.classList.toggle('hidden', row.value === 'national'); placeBox.classList.toggle('hidden', row.value !== 'local'); onChange?.(); };
  row.onchange = toggle;
  state.onchange = () => { loadPlaces(); onChange?.(); };
  place.onchange = () => onChange?.();
  setTimeout(() => { toggle(); if (state.value) loadPlaces(); });
  return { row, state, place, boxes: [field('Row', row), stateBox, placeBox],
    value: () => ({ p_row: row.value, p_state: row.value === 'national' ? null : state.value || null, p_place: row.value === 'local' && place.value ? Number(place.value) : null }) };
}

function firstBiddableDay() {
  const now = new Date(Date.now() + 5.5 * 3600e3);
  const pastClose = now.getUTCHours() >= (me.close_hour_ist ?? 18);
  return addDays(indiaToday(), pastClose ? 2 : 1);
}

async function advBid(c) {
  const ads = (await rpc('market_adv_ads')).filter((a) => a.approved);
  const day = el('input', { type: 'date', value: firstBiddableDay(), min: addDays(indiaToday(), 1), max: addDays(indiaToday(), 60) });
  const out = el('div');
  const region = regionInputs(() => {});
  const load = async () => {
    const r = region.value();
    if (r.p_row !== 'national' && !r.p_state) return fill(out, empty('Choose a state to see its spots.', '🗺️'));
    if (r.p_row === 'local' && !r.p_place) return fill(out, empty('Choose a town or district to see its spots.', '📍'));
    try {
      const m = await rpc('market_adv_market', { p_day: day.value, ...r });
      fill(out, marketPanel(m, ads, load));
    } catch (e) { fill(out, note(errText(e), 'bad', '⚠️')); }
  };
  fill(c,
    !me.bidding_open ? note('Bidding opens soon. You can already see prices and prepare your ads.', 'warn', '⏸️') : null,
    el('div', { class: 'card' }, el('h3', {}, 'Choose a day and a row'),
      el('div', { class: 'grid' }, field('Day', day), region.boxes), el('div', { class: 'actions' }, el('button', { onclick: load }, 'Show spots'))),
    out);
  load();
}

function marketPanel(m, ads, reload) {
  const demand = { low: 'Low demand', medium: 'Medium demand', high: 'High demand' }[m.demand];
  const amount = el('input', { type: 'number', min: 1, value: m.my_bid?.amount_inr ?? '', inputmode: 'numeric', placeholder: 'e.g. 2500' });
  const adSel = el('select', {}, ads.length ? ads.map((a) => el('option', { value: a.id, selected: m.my_bid?.ad_id === a.id }, a.title)) : el('option', { value: '' }, 'No approved ads yet'));
  const lowest = m.row_minimum ?? Math.min(...m.positions.map((p) => p.suggested_price ?? p.min_price));
  const hasTypical = m.positions.some((p) => p.typical_price);
  const place = el('button', { disabled: !m.open || !ads.length }, m.my_bid ? 'Update my bid' : 'Place sealed bid');
  place.onclick = async () => {
    const amt = Number(amount.value);
    if (!amt) return toast('Enter an amount', true);
    if (amt < lowest) return toast(`The minimum for this row is ${inr(lowest)}`, true);
    if (!confirm(`Bid ${inr(amt)} for ${where(m)} on ${dayLong(m.day)}?\nYou pay only if you win, and never more than this.`)) return;
    place.disabled = true;
    await act('market_adv_bid', { p_day: m.day, p_row: m.row_kind, p_state: m.state, p_place: m.place_id ?? null, p_ad: adSel.value, p_amount: amt }, reload, 'Bid saved');
    place.disabled = false;
  };
  const status = m.open
    ? note(['Bidding open · closes ', el('strong', {}, when(m.deadline)), ` · minimum bid ${inr(lowest)}`], 'ok', '🟢')
    : note(!me.bidding_open ? 'Bidding isn\'t open yet. You can prepare your ads and check prices now.' : `Bidding for this day closed at ${when(m.deadline)}. Pick a later day.`, 'warn', '⏰');
  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, `${where(m)} · ${dayLong(m.day)}`),
        el('span', { class: 'demand demand-' + m.demand }, demand + (m.bids != null ? ` · ${m.bids} bids` : ''))),
      status,
      m.special_day ? note(`Special day: prices ×${m.special_day.multiplier}${m.special_day.note ? ' (' + m.special_day.note + ')' : ''}.`, '', '⭐') : null,
      el('div', { class: 'table-wrap' }, el('table', { class: 'pos-table' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Spot'), el('th', {}, 'Suggested price'), hasTypical ? el('th', {}, 'Typical winning price') : null)),
        el('tbody', {}, m.positions.map((p) => el('tr', {}, el('td', {}, el('strong', {}, '#' + p.position)), el('td', {}, inr(p.suggested_price ?? p.min_price)),
          hasTypical ? el('td', {}, p.typical_price ? inr(p.typical_price) : '–') : null))))),
      el('p', { class: 'small', style: 'margin:10px 0 0' }, hasTypical
        ? 'Typical winning price: average of recent auctions for that spot.'
        : 'Suggested prices show what each spot is worth. Winning prices appear here once there\'s enough auction history.')),
    el('div', { class: 'card' },
      el('h3', {}, m.my_bid ? 'Your bid' : 'Place your bid'),
      m.my_bid ? el('p', { class: 'sub' }, `You bid ${inr(m.my_bid.amount_inr)}. You can change or cancel it until bidding closes.`) : el('p', { class: 'sub' }, 'Sealed: nobody else sees your bid.'),
      el('div', { class: 'bid-box' }, field('Ad', adSel), field(`Most you'll pay for the day (at least ${inr(lowest)})`, amount)),
      !ads.length ? note('You need an approved ad first. Create one in "My ads".', 'warn', '📝') : null,
      el('div', { class: 'actions' }, place,
        m.my_bid && m.open ? el('button', { class: 'secondary', onclick: () => confirm('Cancel your bid?') && act('market_adv_cancel_bid', { p_id: m.my_bid.id }, reload, 'Bid cancelled') }, 'Cancel bid') : null),
      el('p', { class: 'small', style: 'margin:14px 0 0' }, 'The highest bid gets spot #1, the next bid #2, and so on. You pay ₹1 more than the bid below yours (at least the row minimum), never more than your own bid.')));
}

async function advBids(c) {
  const bids = await rpc('market_adv_bids');
  const status = { open: ['Waiting', 'warn'], won: ['Won', 'ok'], lost: ['Not won', ''], cancelled: ['Cancelled', ''] };
  fill(c, bids.length ? bids.map((b) => el('div', { class: 'card' },
    el('div', { class: 'list-item' },
      el('div', { class: 'main' },
        el('div', { class: 'row' }, el('span', { class: 'title grow' }, `${dayLong(b.day)} · ${where(b)}`), badge(...status[b.status])),
        el('div', { class: 'meta-line' }, `Ad: ${b.ad_title} · your bid ${inr(b.amount_inr)}`,
          b.status === 'won' ? ` · spot #${b.won_position} · you pay ${inr(b.price_inr)}` : '',
          b.status === 'open' ? ` · closes ${when(b.deadline)}` : '', b.result ? ` · ${b.result}` : '')))))
    : empty('No bids yet. Go to "Bid for a spot" to place one.', '📨'));
}

async function advResults(c) {
  const rows = await rpc('market_adv_results');
  const owed = rows.filter((r) => !r.paid).reduce((s, r) => s + (r.price_inr ?? 0), 0);
  const views = rows.reduce((s, r) => s + (r.views ?? 0), 0), taps = rows.reduce((s, r) => s + (r.taps ?? 0), 0);
  fill(c,
    rows.length ? el('div', { class: 'kpis' },
      kpi('Spots won', num(rows.length)), kpi('Views', num(views)), kpi('Taps', num(taps)), kpi('Tap rate', pct(taps, views)), kpi('To pay', inr(owed))) : null,
    owed ? note([el('strong', {}, `To pay: ${inr(owed)}. `), me.payment_instructions ?? ''], 'warn', '💳') : null,
    rows.length ? dataTable([
      { key: 'day', label: 'Day', fmt: (v) => dayLong(v) },
      { key: 'where', label: 'Spot', get: (r) => `${where(r)} #${r.position}` },
      { key: 'ad_title', label: 'Ad' },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'taps', label: 'Taps', num: true, fmt: num },
      { key: 'rate', label: 'Tap rate', num: true, get: (r) => (r.views ? r.taps / r.views : null), fmt: (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%') },
      { key: 'price_inr', label: 'Price', num: true, fmt: inr },
      { key: 'paid', label: 'Paid', fmt: (v) => (v ? badge('Paid', 'ok') : badge('Not paid', 'warn')) },
    ], rows, { csv: 'my-results', sortKey: 'day' }) : empty('No spots yet. Results appear here once you win a spot.', '📈'));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

let cfg = null;
async function loadCfg() { cfg = await rpc('admin_market_config'); return cfg; }
let adminOpen = null;

function adminView() {
  const [bar, body] = tabs([
    { key: 'dash', label: '📊 Dashboard', render: admDashboard },
    { key: 'day', label: '📅 Day', render: admDay },
    { key: 'advertisers', label: '🏢 Advertisers', render: admAdvertisers },
    { key: 'ads', label: '🖼️ Ads', render: admAds },
    { key: 'book', label: '📌 Book a spot', render: admBook },
    { key: 'bids', label: '🏷️ Bids & auctions', render: admBids },
    { key: 'places', label: '📍 Places', render: admPlaces },
    { key: 'settings', label: '⚙️ Prices & settings', render: admSettings },
    { key: 'activity', label: '🕘 Activity log', render: admActivity },
  ], 'dash', { hash: true });
  adminOpen = (key) => bar.querySelector(`[data-key="${key}"]`)?.click();
  return [bar, body];
}

async function admDay(c) {
  const pick = el('input', { type: 'date', value: c.dataset.day || indiaToday(), style: 'width:auto' });
  const out = el('div');
  const load = async () => {
    c.dataset.day = pick.value;
    const d = await rpc('admin_market_day', { p_day: pick.value });
    fill(out,
      el('div', { class: 'kpis' },
        kpi('Spots booked', num(d.booked)), kpi('Paid', inr(d.revenue_paid)), kpi('Not paid yet', inr(d.revenue_unpaid)),
        kpi('Open bids', num(d.open_bids ?? 0)), kpi('Auctions', d.auctions_enabled ? 'On' : 'Off')),
      d.pending_approval ? note(`${d.pending_approval} ad(s) waiting for review.`, 'warn', '📝') : null,
      d.bookings.length ? d.bookings.map((b) => el('div', { class: 'card' },
        el('div', { class: 'list-item' },
          el('div', { class: 'main' },
            el('div', { class: 'row' }, el('span', { class: 'title' }, `${where(b)} #${b.position}`), b.paid ? badge('Paid', 'ok') : badge('Not paid', 'warn'),
              b.approved ? null : badge('Ad not approved: hidden', 'bad')),
            el('div', { style: 'margin-top:2px' }, `${b.advertiser} – ${b.title}`),
            el('div', { class: 'meta-line' }, `👁 ${num(b.views)} views · 👆 ${num(b.taps)} taps · ${pct(b.taps, b.views)} tap rate`),
            el('div', { class: 'actions' },
              el('button', { class: 'secondary small', onclick: () => act('admin_market_update_booking', { p_id: b.id, p_paid: !b.paid }, load) }, b.paid ? 'Mark not paid' : 'Mark paid'),
              el('button', { class: 'danger small', onclick: () => confirm('Remove this booking?') && act('admin_market_delete_booking', { p_id: b.id }, load, 'Removed') }, 'Remove'))),
          el('div', { class: 'price' }, inr(b.price_inr)))))
        : empty('No bookings this day. Empty spots show Pocketwave\'s own cards.', '📅'));
  };
  pick.onchange = load;
  fill(c, el('div', { class: 'filters' }, field('Day', pick),
    el('button', { class: 'secondary', onclick: () => { pick.value = indiaToday(); load(); } }, 'Today'),
    el('button', { class: 'secondary', onclick: () => { pick.value = addDays(indiaToday(), 1); load(); } }, 'Tomorrow'),
    el('button', { class: 'secondary', onclick: load }, 'Refresh')), el('div', { class: 'mt' }, out));
  await load();
}

// ---- Filter bar for admin lists (filters remember their choice while the page is open) ----

const listFilters = {};
/** defs: [{ key, label, all?, options: [[value, label]] | (values) => [[value, label]] , search?: true, wide?: true }] */
function filterBar(name, defs, onChange) {
  const saved = (listFilters[name] ??= {});
  const inputs = {};
  const box = el('div', { class: 'filters' });
  const build = () => {
    const cur = values();
    fill(box, defs.map((d) => {
      let input;
      if (d.search) {
        input = inputs[d.key] ?? el('input', { type: 'search', placeholder: d.placeholder ?? 'Search…', value: saved[d.key] ?? '' });
        input.oninput = () => { saved[d.key] = input.value; onChange(); };
      } else {
        const opts = typeof d.options === 'function' ? d.options(cur) : d.options;
        const v = saved[d.key] ?? '';
        input = el('select', {}, el('option', { value: '' }, d.all ?? 'All'), opts.map(([val, label]) => el('option', { value: val, selected: String(val) === v }, label)));
        if (v && !opts.some(([val]) => String(val) === v)) { saved[d.key] = ''; input.value = ''; }
        input.onchange = () => { saved[d.key] = input.value; if (d.resets) d.resets.forEach((k) => (saved[k] = '')); build(); onChange(); };
      }
      inputs[d.key] = input;
      return field(d.label, input, d.wide || d.search ? 'wide' : '');
    }), el('button', { class: 'ghost', onclick: () => { Object.keys(saved).forEach((k) => (saved[k] = '')); defs.forEach((d) => d.search && inputs[d.key] && (inputs[d.key].value = '')); build(); onChange(); } }, 'Clear'));
  };
  const values = () => ({ ...saved });
  build();
  return { node: box, values, rebuild: build };
}
const distinct = (list) => [...new Set(list.filter((x) => x != null && x !== ''))].sort((a, b) => String(a).localeCompare(String(b)));
const matches = (q, ...fields) => !q || fields.some((f) => f != null && String(f).toLowerCase().includes(q.trim().toLowerCase()));
const countLine = (shown, total, word) => el('p', { class: 'small', style: 'margin:12px 0' }, shown === total ? `${plural(total, word)}` : `Showing ${num(shown)} of ${plural(total, word)}`);

const ADV_STATUS = { pending: 'Waiting for approval', approved: 'Approved', suspended: 'Suspended', rejected: 'Rejected' };

async function admAdvertisers(c) {
  const list = await rpc('admin_market_advertisers');
  const statusClass = { pending: 'warn', approved: 'ok', rejected: 'bad', suspended: 'bad' };
  const set = (a, status) => {
    const text = status === 'approved' ? null : prompt(`Note to ${a.business_name} (they will see it):`, a.admin_note ?? '');
    if (status !== 'approved' && text === null) return;
    act('admin_market_set_advertiser', { p_id: a.id, p_status: status, p_note: text }, () => admAdvertisers(c));
  };
  const order = { pending: 0, approved: 1, suspended: 2, rejected: 3 };
  const out = el('div');
  const count = (st) => list.filter((a) => a.status === st).length;
  const bar = filterBar('advertisers', [
    { key: 'status', label: 'Status', all: `All (${list.length})`, options: Object.entries(ADV_STATUS).map(([k, v]) => [k, `${v} (${count(k)})`]) },
    { key: 'state', label: 'State', all: 'All states', resets: ['town'], options: distinct(list.map((a) => a.state)).map((s) => [s, s]) },
    { key: 'town', label: 'Town', all: 'All towns', options: (f) => distinct(list.filter((a) => !f.state || a.state === f.state).map((a) => a.city)).map((t) => [t, t]) },
    { key: 'q', label: 'Search', search: true, placeholder: 'Name, phone, email, GST…' },
  ], () => render());
  const render = () => {
    const f = bar.values();
    const rows = list
      .filter((a) => (!f.status || a.status === f.status) && (!f.state || a.state === f.state) && (!f.town || a.city === f.town)
        && matches(f.q, a.business_name, a.contact_name, a.phone, a.email, a.gst, a.city, a.address))
      .sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || String(a.business_name).localeCompare(b.business_name));
    fill(out, countLine(rows.length, list.length, 'advertiser'), rows.length ? rows.map((a) => el('div', { class: 'card' },
      el('div', { class: 'card-head' }, el('h3', {}, a.business_name), badge(ADV_STATUS[a.status] ?? a.status, statusClass[a.status])),
      el('div', { class: 'meta-line' }, [a.contact_name, a.phone, a.email, a.gst ? 'GST ' + a.gst : null, [a.city, a.state].filter(Boolean).join(', '), a.website].filter(Boolean).join(' · ')),
      a.address ? el('div', { class: 'meta-line' }, a.address) : null,
      el('div', { class: 'meta-line' }, `${plural(a.ads, 'ad')} (${a.pending_ads} waiting) · paid ${inr(a.spent)} · owed ${inr(a.owed)} · registered ${when(a.created_at)}`),
      a.admin_note ? el('div', { class: 'meta-line' }, 'Note: ' + a.admin_note) : null,
      el('div', { class: 'actions' },
        a.status !== 'approved' ? el('button', { class: 'small', onclick: () => set(a, 'approved') }, 'Approve') : null,
        a.status === 'pending' ? el('button', { class: 'secondary small', onclick: () => set(a, 'rejected') }, 'Reject') : null,
        a.status === 'approved' ? el('button', { class: 'danger small', onclick: () => set(a, 'suspended') }, 'Suspend') : null)))
      : empty(list.length ? 'No advertisers match these filters.' : 'No advertisers have registered yet.', '🏢'));
  };
  fill(c, bar.node, out);
  render();
}

async function admAds(c) {
  const [ads, advertisers] = await Promise.all([rpc('admin_market_ads'), rpc('admin_market_advertisers').catch(() => [])]);
  const advById = Object.fromEntries(advertisers.map((a) => [a.id, a]));
  const placeOf = (a) => advById[a.advertiser_id] ?? {};
  const formBox = el('div');
  const out = el('div');
  const showForm = (ad) => { fill(formBox, adForm({ ad, admin: true, onSaved: () => admAds(c) })); formBox.scrollIntoView({ behavior: 'smooth' }); };
  const review = (a, ok) => {
    const text = ok ? null : prompt('Why is it not approved? (the advertiser will see this)', '');
    if (!ok && text === null) return;
    act('admin_market_review_ad', { p_id: a.id, p_approved: ok, p_note: text }, () => admAds(c));
  };
  const waitingN = ads.filter((a) => !a.approved).length;
  const bar = filterBar('ads', [
    { key: 'status', label: 'Status', all: `All (${ads.length})`, options: [['waiting', `Waiting for review (${waitingN})`], ['approved', `Approved (${ads.length - waitingN})`]] },
    { key: 'type', label: 'Type', all: 'All types', options: distinct(ads.map((a) => a.category)).map((t) => [t, t]) },
    { key: 'button', label: 'Button', all: 'All buttons', options: Object.entries(ACTIONS) },
    { key: 'adv', label: 'Advertiser', all: 'All advertisers', options: distinct(ads.map((a) => a.advertiser)).map((t) => [t, t]) },
    { key: 'state', label: 'State', all: 'All states', resets: ['town'], options: distinct(ads.map((a) => placeOf(a).state)).map((s) => [s, s]) },
    { key: 'town', label: 'Town', all: 'All towns', options: (f) => distinct(ads.filter((a) => !f.state || placeOf(a).state === f.state).map((a) => placeOf(a).city)).map((t) => [t, t]) },
    { key: 'q', label: 'Search', search: true, placeholder: 'Title, offer…' },
  ], () => render());
  const render = () => {
    const f = bar.values();
    const rows = ads.filter((a) => (!f.status || (f.status === 'approved') === !!a.approved) && (!f.type || a.category === f.type)
      && (!f.button || a.action === f.button) && (!f.adv || a.advertiser === f.adv)
      && (!f.state || placeOf(a).state === f.state) && (!f.town || placeOf(a).city === f.town) && matches(f.q, a.title, a.offer, a.advertiser, a.action_value));
    const waiting = rows.filter((a) => !a.approved), approved = rows.filter((a) => a.approved);
    fill(out, countLine(rows.length, ads.length, 'ad'),
      waiting.length ? el('h3', {}, `Waiting for review (${waiting.length})`) : null,
      waiting.map((a) => adCard(a, [
        el('button', { class: 'small', onclick: () => review(a, true) }, 'Approve'),
        el('button', { class: 'secondary small', onclick: () => review(a, false) }, 'Not approved'),
        el('button', { class: 'secondary small', onclick: () => showForm(a) }, 'Edit')])),
      approved.length ? el('h3', {}, `Approved (${approved.length})`) : null,
      approved.map((a) => adCard(a, [
        el('button', { class: 'secondary small', onclick: () => showForm(a) }, 'Edit'),
        el('button', { class: 'secondary small', onclick: () => review(a, false) }, 'Unapprove'),
        el('button', { class: 'danger small', onclick: () => confirm('Delete this ad and all its bookings and bids?') && act('admin_market_delete_ad', { p_id: a.id }, () => admAds(c), 'Deleted') }, 'Delete')])),
      rows.length ? null : empty(ads.length ? 'No ads match these filters.' : 'No ads yet. Create one below.', '🖼️'));
  };
  fill(c, bar.node, out, formBox);
  render();
  fill(formBox, adForm({ ad: null, admin: true, onSaved: () => admAds(c) }));
}

async function admBook(c) {
  await loadCfg();
  const ads = (await rpc('admin_market_ads')).filter((a) => a.approved);
  const day = el('input', { type: 'date', value: indiaToday() });
  const pos = el('select', {}, Array.from({ length: 10 }, (_, i) => el('option', { value: i + 1 }, '#' + (i + 1))));
  const ad = el('select', {}, ads.length ? ads.map((a) => el('option', { value: a.id }, `${a.advertiser} – ${a.title}`)) : el('option', { value: '' }, 'No approved ads'));
  const price = el('input', { type: 'number', min: 0, placeholder: 'empty = price list' });
  const hint = el('p', { class: 'small' });
  const region = regionInputs(() => updateHint());
  function updateHint() {
    const p = cfg.prices.find((x) => x.row_kind === region.row.value && x.position === Number(pos.value));
    const sp = cfg.special_days.find((x) => x.day === day.value);
    hint.textContent = `Price list for this spot: ${inr(p ? Math.round(p.price_inr * (sp ? Number(sp.multiplier) : 1)) : 0)}${sp ? ` (special day ×${sp.multiplier})` : ''}`;
  }
  day.onchange = updateHint; pos.onchange = updateHint;
  const save = el('button', {}, 'Book spot');
  save.onclick = () => {
    if (!ad.value) return toast('Approve an ad first', true);
    const r = region.value();
    act('admin_market_book', { p_day: day.value, p_position: Number(pos.value), p_ad: ad.value, ...r, p_price: price.value ? Number(price.value) : null }, null, 'Booked');
  };
  fill(c, card('Book a spot at a fixed price', 'For deals agreed by email or phone. Skips the auction.',
    el('div', { class: 'grid' }, field('Day', day), region.boxes, field('Position', pos), field('Ad', ad), field('Price ₹', price)), hint, el('div', { class: 'actions' }, save)));
  updateHint();
}

async function admBids(c) {
  await loadCfg();
  const day = el('input', { type: 'date', value: c.dataset.day || addDays(indiaToday(), 1), style: 'width:auto' });
  const list = el('div');
  const ads = (await rpc('admin_market_ads')).filter((a) => a.approved);
  const region = regionInputs();
  const ad = el('select', {}, ads.length ? ads.map((a) => el('option', { value: a.id }, `${a.advertiser} – ${a.title}`)) : el('option', { value: '' }, 'No approved ads'));
  const amount = el('input', { type: 'number', min: 1 });
  const status = { open: 'warn', won: 'ok', lost: '', cancelled: '' };
  const load = async () => {
    c.dataset.day = day.value;
    const bids = await rpc('admin_market_bids', { p_day: day.value });
    fill(list, bids.length ? dataTable([
      { key: 'where', label: 'Row', get: (b) => where(b) },
      { key: 'advertiser', label: 'Advertiser', get: (b) => `${b.advertiser} – ${b.title}` },
      { key: 'amount_inr', label: 'Bid', num: true, fmt: inr },
      { key: 'status', label: 'Status', fmt: (v) => badge(v.toUpperCase(), status[v]) },
      { key: 'won_position', label: 'Spot', num: true, fmt: (v) => (v ? '#' + v : '–') },
      { key: 'price_inr', label: 'Pays', num: true, fmt: inr },
      { key: 'by', label: 'Placed by', get: (b) => (b.advertiser_id ? 'Advertiser' : 'Admin') },
      { key: 'x', label: '', get: () => '', fmt: (_, b) => (b.status === 'open' ? el('button', { class: 'secondary small', onclick: () => act('admin_market_cancel_bid', { p_id: b.id }, load, 'Cancelled') }, 'Cancel') : '') },
    ], bids, { sortKey: 'amount_inr', limit: 200 }) : empty('No bids for this day.', '🏷️'));
  };
  day.onchange = load;
  const s = cfg.settings;
  fill(c,
    el('div', { class: 'filters' }, field('Day', day), el('button', { class: 'secondary', onclick: load }, 'Refresh'), el('span', { class: 'grow' }),
      el('button', { onclick: () => confirm(`Close all open bids for ${day.value} now? Winners get booked.`) && act('admin_market_run_auctions', { p_day: day.value }, load, 'Auctions closed') }, 'Run auctions for this day now')),
    el('div', { class: 'row', style: 'margin:10px 0 14px' },
      badge(`Advertiser bidding: ${s.advertiser_bidding_open ? 'open' : 'closed'}`, s.advertiser_bidding_open ? 'ok' : 'warn'),
      badge(`Automatic auctions: ${s.auctions_enabled ? `on (${s.auction_close_hour_ist}:00 IST)` : 'off'}`, s.auctions_enabled ? 'ok' : '')),
    card('Add a bid', 'For testing, or for a bid that came by email.',
      el('div', { class: 'grid' }, region.boxes, field('Ad', ad), field('Most they\'ll pay ₹', amount)),
      el('div', { class: 'actions' }, el('button', { onclick: () => {
        if (!ad.value) return toast('Approve an ad first', true);
        if (!Number(amount.value)) return toast('Enter an amount', true);
        act('admin_market_add_bid', { p_day: day.value, p_ad: ad.value, p_amount: Number(amount.value), ...region.value() }, () => { amount.value = ''; return load(); }, 'Bid added');
      } }, 'Add bid'))),
    el('h3', {}, 'Bids for this day'),
    list);
  await load();
}

async function admSettings(c) {
  await loadCfg();
  const s = cfg.settings;
  const email = el('input', { value: s.contact_email });
  const hour = el('input', { type: 'number', min: 0, max: 23, value: s.auction_close_hour_ist });
  const cap = el('input', { type: 'number', min: 1, max: 10, value: s.max_spots_per_advertiser });
  const pay = el('textarea', {}); pay.value = s.payment_instructions ?? '';
  const chk = (v) => el('input', { type: 'checkbox', checked: v });
  const signup = chk(s.advertiser_signup_open), bidding = chk(s.advertiser_bidding_open), auctions = chk(s.auctions_enabled), exact = chk(s.show_exact_bid_count);
  const save = () => act('admin_market_save_settings', { p: {
    contact_email: email.value.trim(), auction_close_hour_ist: Number(hour.value), max_spots_per_advertiser: Number(cap.value),
    payment_instructions: pay.value.trim(), advertiser_signup_open: signup.checked, advertiser_bidding_open: bidding.checked,
    auctions_enabled: auctions.checked, show_exact_bid_count: exact.checked } }, () => admSettings(c));
  const prices = el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, el('th', {}, 'Spot'), Object.values(ROWS).map((r) => el('th', {}, r)))),
    el('tbody', {}, Array.from({ length: 10 }, (_, i) => el('tr', {}, el('td', {}, el('strong', {}, '#' + (i + 1))), Object.keys(ROWS).map((k) => {
      const p = cfg.prices.find((x) => x.row_kind === k && x.position === i + 1);
      const inp = el('input', { type: 'number', min: 0, value: p?.price_inr ?? 0 });
      inp.onchange = () => act('admin_market_set_price', { p_row: k, p_position: i + 1, p_price: Number(inp.value) });
      return el('td', {}, inp);
    }))))));
  const spDay = el('input', { type: 'date' }), spMult = el('input', { type: 'number', step: 0.5, min: 1, max: 10, value: 2 }), spNote = el('input', { placeholder: 'IPL final' });
  fill(c,
    card('Switches', null,
      el('label', { class: 'check' }, signup, el('span', {}, 'Businesses can register')),
      el('label', { class: 'check' }, bidding, el('span', {}, 'Approved advertisers can place bids')),
      el('label', { class: 'check' }, auctions, el('span', {}, 'Close auctions automatically every evening for the next day')),
      el('label', { class: 'check' }, exact, el('span', {}, 'Show advertisers the exact number of bids (otherwise Low / Medium / High demand)')),
      el('div', { class: 'grid', style: 'margin-top:18px' }, field('Contact email shown in the app and here', email), field('Bidding closes at (hour, India time, day before)', hour), field('Max spots per advertiser per row', cap)),
      field('Payment instructions shown to winners', pay),
      el('div', { class: 'actions' }, el('button', { onclick: save }, 'Save settings'))),
    card('Price list (₹ per day)', 'Used as the fixed price when you book a spot by hand, and shown to advertisers as suggested prices. In auctions, the #10 price of each row is the minimum bid. Each box saves when you leave it.', prices),
    card('Special days (prices multiply)', null,
      el('div', { class: 'grid' }, field('Day', spDay), field('Multiplier', spMult), field('Note', spNote)),
      el('div', { class: 'actions' }, el('button', { onclick: () => spDay.value ? act('admin_market_special_day', { p_day: spDay.value, p_multiplier: Number(spMult.value), p_note: spNote.value.trim() || null }, () => admSettings(c)) : toast('Pick a day', true) }, 'Add special day')),
      cfg.special_days.length ? el('div', { class: 'mt' }, cfg.special_days.map((d) => el('div', { class: 'row', style: 'margin:6px 0' }, badge(`×${d.multiplier}`, 'info'), el('span', { class: 'grow' }, `${dayLong(d.day)}${d.note ? ' · ' + d.note : ''}`),
        el('button', { class: 'secondary small', onclick: () => act('admin_market_special_day', { p_day: d.day, p_multiplier: null }, () => admSettings(c), 'Removed') }, 'Remove'))))
        : el('p', { class: 'small' }, 'No special days coming up.')));
}

async function admPlaces(c) {
  const state = stateSelect(c.dataset.state || 'Tamil Nadu');
  const list = el('div');
  const district = el('select');
  const name = el('input', { maxlength: 60, placeholder: 'Town or district name' });
  const load = async () => {
    c.dataset.state = state.value;
    if (!state.value) return fill(list, empty('Choose a state.', '🗺️'));
    const places = await rpc('admin_market_places', { p_state: state.value });
    delete placeCache[state.value];
    const districts = places.filter((p) => p.kind === 'district');
    fill(district, el('option', { value: '' }, '— add as a new district —'), districts.map((d) => el('option', { value: d.id }, `Town in ${d.name} district`)));
    fill(list, el('p', { class: 'small' }, `${districts.length} districts · ${places.length - districts.length} towns. Hidden places don't appear in the app; people who chose them keep them.`),
      dataTable([
        { key: 'name', label: 'Place', fmt: (v, p) => (p.kind === 'district' ? el('strong', {}, `${v} district`) : `↳ ${v}`) },
        { key: 'users', label: 'People', num: true, fmt: num },
        { key: 'active', label: 'Shown', fmt: (v, p) => el('button', { class: (v ? 'secondary ' : '') + 'small', onclick: () => act('admin_market_set_place_active', { p_id: p.id, p_active: !v }, load) }, v ? 'Hide' : 'Show') },
      ], places, { limit: 400, csv: 'places-' + state.value }));
  };
  state.onchange = load;
  const add = el('button', { onclick: () => {
    if (!state.value || name.value.trim().length < 2) return toast('Choose a state and enter a name', true);
    act('admin_market_add_place', { p_state: state.value, p_name: name.value.trim(), p_district: district.value ? Number(district.value) : null }, () => { name.value = ''; return load(); }, 'Added');
  } }, 'Add place');
  fill(c,
    card('Add a town or district', 'Add towns people ask for. New districts (created recently by the government) can be added the same way.',
      el('div', { class: 'grid' }, field('State', state), field('Add as', district), field('Name', name)), el('div', { class: 'actions' }, add)),
    list);
  await load();
}

const AUDIT_NAMES = { market_ads: 'Ad', market_bookings: 'Booking', market_bids: 'Bid', market_advertisers: 'Advertiser', market_prices: 'Price',
  market_settings: 'Settings', market_special_days: 'Special day', market_house_cards: 'House card', market_places: 'Place' };
const AUDIT_VERBS = { INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Removed' };

async function admActivity(c) {
  const rows = await rpc('admin_market_audit', { p_limit: 1000 });
  const out = el('div');
  const bar = filterBar('activity', [
    { key: 'type', label: 'Type', all: 'All types', options: distinct(rows.map((r) => r.tbl)).map((t) => [t, AUDIT_NAMES[t] ?? t]) },
    { key: 'op', label: 'Action', all: 'All actions', options: Object.entries(AUDIT_VERBS) },
    { key: 'who', label: 'Who', all: 'Everyone', wide: true, options: distinct(rows.map((r) => r.who)).map((w) => [w, w]) },
    { key: 'day', label: 'When', all: 'Any time', options: [['1', 'Last 24 hours'], ['7', 'Last 7 days'], ['30', 'Last 30 days']] },
  ], () => render());
  const render = () => {
    const f = bar.values();
    const since = f.day ? Date.now() - Number(f.day) * 86400e3 : 0;
    const list = rows.filter((r) => (!f.type || r.tbl === f.type) && (!f.op || r.op === f.op) && (!f.who || r.who === f.who) && (!since || new Date(r.at).getTime() >= since));
    fill(out, dataTable([
      { key: 'at', label: 'When', fmt: (v) => when(v) },
      { key: 'who', label: 'Who' },
      { key: 'tbl', label: 'Type', fmt: (v) => AUDIT_NAMES[v] ?? v, csv: (r) => AUDIT_NAMES[r.tbl] ?? r.tbl },
      { key: 'op', label: 'Action', fmt: (v) => badge(AUDIT_VERBS[v] ?? v, v === 'DELETE' ? 'bad' : v === 'INSERT' ? 'ok' : 'info'), csv: (r) => AUDIT_VERBS[r.op] ?? r.op },
    ], list, { csv: 'activity', limit: 100, emptyText: 'No changes match these filters.' }));
  };
  fill(c, bar.node, el('p', { class: 'small', style: 'margin:12px 0' }, 'Every change to the Market, newest first (last 1,000). Kept for one year.'), out);
  render();
}

// ---------------------------------------------------------------------------
// Admin dashboard
// ---------------------------------------------------------------------------

const RANGES = {
  '7': ['Last 7 days', () => [addDays(indiaToday(), -6), indiaToday()]],
  '30': ['Last 30 days', () => [addDays(indiaToday(), -29), indiaToday()]],
  '90': ['Last 90 days', () => [addDays(indiaToday(), -89), indiaToday()]],
  month: ['This month', () => [indiaToday().slice(0, 8) + '01', indiaToday()]],
  lastmonth: ['Last month', () => { const first = indiaToday().slice(0, 8) + '01'; const end = addDays(first, -1); return [end.slice(0, 8) + '01', end]; }],
  next30: ['Next 30 days (booked ahead)', () => [addDays(indiaToday(), 1), addDays(indiaToday(), 30)]],
  year: ['Last 365 days', () => [addDays(indiaToday(), -364), indiaToday()]],
  custom: ['Custom…', null],
};
const dash = { range: '30', from: null, to: null, row: '', state: '', adv: '', tab: 'overview', data: null, app: null, key: '' };

async function admDashboard(c) {
  const sub = hashParts()[1];
  if (hashParts()[0] === 'dash' && sub && ['overview', 'revenue', 'spots', 'places', 'advertisers', 'ads', 'bids', 'audience', 'app'].includes(sub)) dash.tab = sub;
  else setHash('dash', dash.tab);
  [dash.from, dash.to] = dash.range === 'custom' && dash.from ? [dash.from, dash.to] : RANGES[dash.range][1]();
  const range = el('select', {}, Object.entries(RANGES).map(([k, [label]]) => el('option', { value: k, selected: k === dash.range }, label)));
  const from = el('input', { type: 'date', value: dash.from }), to = el('input', { type: 'date', value: dash.to });
  const fromBox = field('From', from), toBox = field('To', to);
  const row = el('select', {}, el('option', { value: '' }, 'All rows'), Object.entries(ROWS).map(([k, v]) => el('option', { value: k, selected: k === dash.row }, v)));
  const state = stateSelect(dash.state, 'All states');
  const adv = el('select', {}, el('option', { value: '' }, 'All advertisers'));
  const body = el('div');
  const showCustom = () => { const on = range.value === 'custom'; fromBox.classList.toggle('hidden', !on); toBox.classList.toggle('hidden', !on); };
  showCustom();

  const load = async (force = false) => {
    if (range.value !== 'custom') [from.value, to.value] = RANGES[range.value][1]();
    Object.assign(dash, { range: range.value, from: from.value, to: to.value, row: row.value, state: state.value, adv: adv.value });
    const key = JSON.stringify([dash.from, dash.to, dash.row, dash.state, dash.adv]);
    if (force || key !== dash.key || !dash.data) {
      fill(body, el('p', { class: 'small' }, 'Loading reports…'));
      try {
        dash.data = await rpc('admin_market_dashboard', { p_from: dash.from, p_to: dash.to, p_row: dash.row || null, p_state: dash.state || null, p_advertiser: dash.adv || null });
        dash.app = null; dash.key = key;
      } catch (e) { return fill(body, note(errText(e), 'bad', '⚠️')); }
      const keep = adv.value;
      fill(adv, el('option', { value: '' }, 'All advertisers'), (dash.data.filters?.advertisers ?? []).map((a) => el('option', { value: a.key, selected: a.key === keep }, a.name)));
    }
    renderDash(body);
  };
  [range, from, to, row, state, adv].forEach((i) => (i.onchange = () => { showCustom(); if (range.value !== 'custom' || (from.value && to.value)) load(); }));

  const subTabs = [
    ['overview', 'Overview'], ['revenue', 'Revenue'], ['spots', 'Spots'], ['places', 'Places'], ['advertisers', 'Advertisers'],
    ['ads', 'Ads'], ['bids', 'Bids'], ['audience', 'Audience'], ['app', 'App'],
  ];
  const bar = el('div', { class: 'tabs sub', role: 'tablist' }, subTabs.map(([k, label]) => el('button', { 'data-key': k, role: 'tab', class: k === dash.tab ? 'on' : '',
    onclick: (ev) => { dash.tab = k; setHash('dash', k); [...bar.children].forEach((b) => b.classList.toggle('on', b === ev.currentTarget)); renderDash(body); } }, label)));

  fill(c,
    el('div', { class: 'filters' },
      field('Dates', range, 'wide'), fromBox, toBox, field('Row', row), field('State', state), field('Advertiser', adv, 'wide'),
      el('button', { class: 'secondary', onclick: () => load(true) }, '↻ Refresh'),
      el('button', { class: 'ghost', onclick: () => { range.value = '30'; row.value = ''; state.value = ''; adv.value = ''; showCustom(); load(); } }, 'Reset')),
    bar, body);
  await load();
}

function renderDash(body) {
  const d = dash.data;
  if (!d) return;
  const views = {
    overview: dashOverview, revenue: dashRevenue, spots: dashSpots, places: dashPlaces, advertisers: dashAdvertisers,
    ads: dashAds, bids: dashBids, audience: dashAudience, app: dashApp,
  };
  const scope = [`${dayLong(d.from)} – ${dayLong(d.to)}`, dash.row ? ROW_SHORT[dash.row] : null, dash.state || null,
    dash.adv ? (d.filters.advertisers.find((a) => a.key === dash.adv)?.name ?? 'one advertiser') : null].filter(Boolean).join(' · ');
  fill(body, el('p', { class: 'small', style: 'margin:0 0 12px' }, scope));
  Promise.resolve(views[dash.tab](d, body)).catch((e) => body.append(note(errText(e), 'bad', '⚠️')));
}

const S1 = 'var(--s1)', S2 = 'var(--s2)';

function dashOverview(d, body) {
  const k = d.kpis, b = d.bid_kpis, f = d.advertiser_funnel;
  const todo = [
    f.pending ? kpi('Advertisers to review', num(f.pending), 'Waiting for approval', () => adminOpen('advertisers')) : null,
    f.ads_pending ? kpi('Ads to review', num(f.ads_pending), 'Waiting for approval', () => adminOpen('ads')) : null,
    k.unpaid ? kpi('Not paid yet', inr(k.unpaid), 'In this period', () => { dash.tab = 'revenue'; setHash('dash', 'revenue'); adminOpen('dash'); }) : null,
  ].filter(Boolean);
  body.append(
    todo.length ? el('div', {}, el('h3', {}, 'Needs your attention'), el('div', { class: 'kpis' }, todo)) : null,
    el('div', { class: 'kpis' },
      kpi('Revenue', inr(k.revenue), `${inr(k.paid)} paid`),
      kpi('Spots sold', num(k.bookings), `${num(k.auction_bookings)} by auction`),
      kpi('Avg price', inr(k.avg_price), 'per spot'),
      kpi('Views', num(k.views), 'unique per day'),
      kpi('Taps', num(k.taps), `${pct(k.taps, k.views)} tap rate`),
      kpi('National filled', pct(k.national_filled, k.national_capacity), `${num(k.national_filled)} of ${num(k.national_capacity)} spots`),
      kpi('Bids', num(b.bids - b.cancelled), plural(b.bidders, 'bidder')),
      kpi('Advertisers', num(k.advertisers), `${num(f.approved)} approved in total`)),
    el('div', { class: 'cols' },
      chartCard('Revenue per day', 'Booked spots, paid and not paid.', columnChart(d.daily, [{ key: 'revenue', name: 'Revenue', color: S1 }], { fmt: inr })),
      chartCard('Views per day', 'People who saw an ad (each person counted once per ad).', lineChart(d.daily, 'views', { name: 'Views' }))),
    el('div', { class: 'cols mt' },
      chartCard('Revenue by row', null, hbars(d.by_row.map((r) => ({ name: ROW_SHORT[r.row_kind], value: r.revenue })), { fmt: inr })),
      chartCard('Top advertisers', 'By spend in this period.', hbars(d.advertisers.map((a) => ({ name: a.name, value: a.revenue })), { fmt: inr, max: 8 }))));
}

function dashRevenue(d, body) {
  const k = d.kpis;
  body.append(
    el('div', { class: 'kpis' },
      kpi('Revenue', inr(k.revenue)), kpi('Paid', inr(k.paid), pct(k.paid, k.revenue) + ' collected'), kpi('Not paid yet', inr(k.unpaid)),
      kpi('Avg price', inr(k.avg_price)), kpi('Per day', inr(Math.round(k.revenue / d.days)), `over ${d.days} days`)),
    chartCard('Paid and not paid per day', null, columnChart(d.daily.map((x) => ({ ...x, unpaid: Math.max(0, x.revenue - x.paid) })),
      [{ key: 'paid', name: 'Paid', color: S1 }, { key: 'unpaid', name: 'Not paid', color: S2 }], { fmt: inr, wide: true })),
    el('div', { class: 'cols mt' },
      chartCard('By row', null, dataTable([
        { key: 'row_kind', label: 'Row', fmt: (v) => ROW_SHORT[v] },
        { key: 'bookings', label: 'Spots', num: true, fmt: num },
        { key: 'revenue', label: 'Revenue', num: true, fmt: inr },
        { key: 'avg_price', label: 'Avg', num: true, fmt: inr },
      ], d.by_row, { csv: 'revenue-by-row' })),
      chartCard('By category', 'From the ad\'s category.', dataTable([
        { key: 'category', label: 'Category' },
        { key: 'bookings', label: 'Spots', num: true, fmt: num },
        { key: 'revenue', label: 'Revenue', num: true, fmt: inr },
        { key: 'rate', label: 'Tap rate', num: true, get: (r) => (r.views ? r.taps / r.views : null), fmt: (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%') },
      ], d.categories, { csv: 'revenue-by-category', sortKey: 'revenue' }))),
    chartCard('Every booked spot', 'Up to 1,000 newest.', bookingTable(d.booking_list)));
}

function bookingTable(rows) {
  return dataTable([
    { key: 'day', label: 'Day', fmt: (v) => dayLabel(v) },
    { key: 'where', label: 'Row', get: (r) => `${where(r)} #${r.position}` },
    { key: 'advertiser', label: 'Advertiser' },
    { key: 'title', label: 'Ad' },
    { key: 'price_inr', label: 'Price', num: true, fmt: inr },
    { key: 'paid', label: 'Paid', fmt: (v) => (v ? badge('Paid', 'ok') : badge('Not paid', 'warn')), csv: (r) => (r.paid ? 'yes' : 'no') },
    { key: 'views', label: 'Views', num: true, fmt: num },
    { key: 'taps', label: 'Taps', num: true, fmt: num },
    { key: 'note', label: 'How', fmt: (v) => (v === 'auction' ? 'Auction' : 'Booked by hand') },
  ], rows, { csv: 'bookings', sortKey: 'day', limit: 25 });
}

function dashSpots(d, body) {
  const rowKinds = dash.row ? [dash.row] : ['national', 'regional', 'local'];
  const byPos = (rk) => Array.from({ length: 10 }, (_, i) => d.by_position.find((p) => p.row_kind === rk && p.position === i + 1) ?? { row_kind: rk, position: i + 1, bookings: 0, revenue: 0, views: 0, taps: 0 });
  const k = d.kpis;
  body.append(
    el('div', { class: 'kpis' },
      kpi('National filled', pct(k.national_filled, k.national_capacity), `${num(k.national_filled)} of ${num(k.national_capacity)}`),
      kpi('Spots sold', num(k.bookings)), kpi('Avg price', inr(k.avg_price)), kpi('Tap rate', pct(k.taps, k.views))),
    el('div', { class: 'cols' }, rowKinds.map((rk) => chartCard(`${ROW_SHORT[rk]}: average price by spot`, 'Does #1 really earn more than #10?',
      hbars(byPos(rk).map((p) => ({ name: '#' + p.position, value: p.avg_price ?? 0 })), { fmt: inr, zeros: true }))),
    ),
    el('div', { class: 'cols mt' }, rowKinds.map((rk) => chartCard(`${ROW_SHORT[rk]}: tap rate by spot`, 'Taps ÷ views. Shows how much position matters to people.',
      hbars(byPos(rk).map((p) => ({ name: '#' + p.position, value: p.views ? +((p.taps / p.views) * 100).toFixed(1) : 0 })), { fmt: (v) => v + '%', zeros: true })))),
    chartCard('Every spot', null, dataTable([
      { key: 'row_kind', label: 'Row', fmt: (v) => ROW_SHORT[v] },
      { key: 'position', label: 'Spot', num: true, fmt: (v) => '#' + v },
      { key: 'bookings', label: 'Sold', num: true, fmt: num },
      { key: 'avg_price', label: 'Avg price', num: true, fmt: inr },
      { key: 'min_price', label: 'Lowest', num: true, fmt: inr },
      { key: 'max_price', label: 'Highest', num: true, fmt: inr },
      { key: 'revenue', label: 'Revenue', num: true, fmt: inr },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'taps', label: 'Taps', num: true, fmt: num },
      { key: 'rate', label: 'Tap rate', num: true, get: (r) => (r.views ? r.taps / r.views : null), fmt: (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%') },
    ], d.by_position, { csv: 'spots', limit: 30 })));
}

function dashPlaces(d, body) {
  body.append(
    el('div', { class: 'cols' },
      chartCard('People by state', 'People who set their place in Market.', hbars(d.by_state.map((s) => ({ name: s.state, value: s.users })))),
      chartCard('Revenue by state', 'Regional and Near-you spots.', hbars(d.by_state.map((s) => ({ name: s.state, value: s.revenue })), { fmt: inr }))),
    chartCard('States', null, dataTable([
      { key: 'state', label: 'State' },
      { key: 'users', label: 'People', num: true, fmt: num },
      { key: 'bookings', label: 'Spots sold', num: true, fmt: num },
      { key: 'revenue', label: 'Revenue', num: true, fmt: inr },
      { key: 'bids', label: 'Bids', num: true, fmt: num },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'taps', label: 'Taps', num: true, fmt: num },
    ], d.by_state, { csv: 'states', sortKey: 'users', emptyText: 'Nobody has set a place yet, and no regional spots sold.' })),
    chartCard('Towns and districts', 'Places with people, spots or bids. Good places to sell "Near you" spots.', dataTable([
      { key: 'name', label: 'Place', fmt: (v, p) => (p.kind === 'district' ? `${v} district` : v) },
      { key: 'state', label: 'State' },
      { key: 'users', label: 'People', num: true, fmt: num },
      { key: 'bookings', label: 'Spots sold', num: true, fmt: num },
      { key: 'revenue', label: 'Revenue', num: true, fmt: inr },
      { key: 'bids', label: 'Bids', num: true, fmt: num },
      { key: 'views', label: 'Views', num: true, fmt: num },
    ], d.by_place, { csv: 'places', sortKey: 'users', emptyText: 'No towns or districts with activity yet.' })));
}

function dashAdvertisers(d, body) {
  const f = d.advertiser_funnel;
  const statusClass = { pending: 'warn', approved: 'ok', rejected: 'bad', suspended: 'bad' };
  body.append(
    el('div', { class: 'kpis' },
      kpi('Waiting', num(f.pending), 'to be reviewed', f.pending ? () => adminOpen('advertisers') : null),
      kpi('Approved', num(f.approved)), kpi('Rejected', num(f.rejected)), kpi('Suspended', num(f.suspended)),
      kpi('New', num(f.new_in_range), 'registered in this period'), kpi('Ads approved', num(f.ads_approved), `${num(f.ads_pending)} waiting`)),
    chartCard('Spend by advertiser', null, hbars(d.advertisers.map((a) => ({ name: a.name, value: a.revenue })), { fmt: inr, max: 12 })),
    chartCard('All advertisers', '"admin-added" means ads you created for a brand without an account.', dataTable([
      { key: 'name', label: 'Business' },
      { key: 'status', label: 'Status', fmt: (v) => badge(v, statusClass[v] ?? '') },
      { key: 'place', label: 'Place', get: (a) => [a.city, a.state].filter(Boolean).join(', ') || null },
      { key: 'ads', label: 'Ads', num: true, fmt: num },
      { key: 'bids', label: 'Bids', num: true, fmt: num },
      { key: 'won', label: 'Won', num: true, fmt: num },
      { key: 'winrate', label: 'Win rate', num: true, get: (a) => (a.bids ? a.won / a.bids : null), fmt: (v) => (v == null ? '–' : Math.round(v * 100) + '%') },
      { key: 'avg_bid', label: 'Avg bid', num: true, fmt: inr },
      { key: 'bookings', label: 'Spots', num: true, fmt: num },
      { key: 'revenue', label: 'Spend', num: true, fmt: inr },
      { key: 'owed', label: 'Owes', num: true, fmt: (v) => (v ? el('span', { class: 'warn' }, inr(v)) : inr(v)) },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'taps', label: 'Taps', num: true, fmt: num },
    ], d.advertisers, { csv: 'advertisers', sortKey: 'revenue' })));
}

function dashAds(d, body) {
  body.append(
    el('div', { class: 'cols' },
      chartCard('Most viewed ads', null, hbars(d.ads.map((a) => ({ name: a.title, value: a.views })), { max: 10 })),
      chartCard('Best tap rate', 'Ads with at least 20 views.', hbars(d.ads.filter((a) => a.views >= 20).map((a) => ({ name: a.title, value: +((a.taps / a.views) * 100).toFixed(1) }))
        .sort((x, y) => y.value - x.value), { fmt: (v) => v + '%' }))),
    chartCard('All ads', 'Saves = people who saved the ad in the app (all time).', dataTable([
      { key: 'title', label: 'Ad' },
      { key: 'advertiser', label: 'Advertiser' },
      { key: 'category', label: 'Category' },
      { key: 'approved', label: 'Status', fmt: (v) => (v ? badge('Approved', 'ok') : badge('Waiting', 'warn')), csv: (a) => (a.approved ? 'approved' : 'waiting') },
      { key: 'bookings', label: 'Spots', num: true, fmt: num },
      { key: 'revenue', label: 'Spend', num: true, fmt: inr },
      { key: 'views', label: 'Views', num: true, fmt: num },
      { key: 'taps', label: 'Taps', num: true, fmt: num },
      { key: 'rate', label: 'Tap rate', num: true, get: (a) => (a.views ? a.taps / a.views : null), fmt: (v) => (v == null ? '–' : (v * 100).toFixed(1) + '%') },
      { key: 'saves', label: 'Saves', num: true, fmt: num },
    ], d.ads, { csv: 'ads', sortKey: 'views' })));
}

function dashBids(d, body) {
  const b = d.bid_kpis;
  const status = { open: 'warn', won: 'ok', lost: '', cancelled: '' };
  body.append(
    el('div', { class: 'kpis' },
      kpi('Bids', num(b.bids - b.cancelled), `${num(b.cancelled)} cancelled`), kpi('Waiting', num(b.open), 'auction not run yet'),
      kpi('Won', num(b.won), pct(b.won, b.won + b.lost) + ' win rate'), kpi('Lost', num(b.lost)),
      kpi('Avg bid', inr(b.avg_bid)), kpi('Highest bid', inr(b.max_bid)),
      kpi('Bid vs paid', inr(b.bid_value - b.won_value), 'winners saved by paying ₹1 over the next bid')),
    chartCard('Bids per day', 'By the day the spot runs.', columnChart(d.daily.map((x) => ({ ...x, lostish: Math.max(0, x.bids - x.won) })),
      [{ key: 'won', name: 'Won', color: S1 }, { key: 'lostish', name: 'Not won / waiting', color: S2 }], { wide: true })),
    chartCard('By row', null, dataTable([
      { key: 'row_kind', label: 'Row', fmt: (v) => ROW_SHORT[v] },
      { key: 'bids', label: 'Bids', num: true, fmt: num },
      { key: 'won', label: 'Won', num: true, fmt: num },
      { key: 'lost', label: 'Lost', num: true, fmt: num },
      { key: 'avg_bid', label: 'Avg bid', num: true, fmt: inr },
      { key: 'max_bid', label: 'Highest', num: true, fmt: inr },
      { key: 'avg_paid', label: 'Avg paid', num: true, fmt: inr },
    ], d.bids_by_row, { csv: 'bids-by-row' })),
    chartCard('Every bid', 'Up to 500 newest.', dataTable([
      { key: 'day', label: 'Day', fmt: (v) => dayLabel(v) },
      { key: 'where', label: 'Row', get: (r) => where(r) },
      { key: 'advertiser', label: 'Advertiser' },
      { key: 'title', label: 'Ad' },
      { key: 'amount_inr', label: 'Bid', num: true, fmt: inr },
      { key: 'status', label: 'Status', fmt: (v) => badge(v, status[v]) },
      { key: 'won_position', label: 'Spot', num: true, fmt: (v) => (v ? '#' + v : '–') },
      { key: 'price_inr', label: 'Paid', num: true, fmt: inr },
      { key: 'created_at', label: 'Placed', fmt: (v) => when(v) },
    ], d.bid_list, { csv: 'bids', sortKey: 'day', limit: 25 })));
}

function dashAudience(d, body) {
  const a = d.audience;
  body.append(
    el('div', { class: 'kpis' },
      kpi('People with a state', num(a.users_with_state), 'chose a state in Market'),
      kpi('People with a town', num(a.users_with_place), 'chose a town or district'),
      kpi('Saved ads', num(a.saves_in_range), `${num(a.saves_total)} all time`),
      kpi('Views', num(d.kpis.views)), kpi('Taps', num(d.kpis.taps), pct(d.kpis.taps, d.kpis.views) + ' tap rate')),
    el('div', { class: 'cols' },
      chartCard('Taps per day', null, lineChart(d.daily, 'taps', { name: 'Taps' })),
      chartCard('Places set or changed per day', 'Last change per person.', columnChart(a.place_changes, [{ key: 'n', name: 'People', color: S1 }]))),
    chartCard('Where people are', 'Top states by people who set a place.', hbars(d.by_state.map((s) => ({ name: s.state, value: s.users })), { max: 15 })));
}

async function dashApp(d, body) {
  if (!dash.app) {
    const wait = el('p', { class: 'small' }, 'Loading app numbers…');
    body.append(wait);
    dash.app = await rpc('admin_app_dashboard', { p_from: dash.from, p_to: dash.to });
    wait.remove();
  }
  const a = dash.app, t = a.totals, r = a.in_range ?? {};
  body.append(
    note('App-wide numbers. Only dates apply here (not row, state or advertiser). Counts only: no message text, no names.', '', 'ℹ️'),
    el('div', { class: 'kpis' },
      kpi('Users', num(t.users), `${num(r.users ?? 0)} new in this period`),
      kpi('Active today', num(t.active_1d), 'last 24 hours'), kpi('Active 7 days', num(t.active_7d)), kpi('Active 30 days', num(t.active_30d)),
      kpi('Messages', num(r.messages ?? 0), 'sent in this period'), kpi('New chats', num(r.connections ?? 0), `${num(t.connections)} all time`),
      kpi('Groups', num(t.groups), `${num(r.groups ?? 0)} new`), kpi('Games', num(r.games ?? 0), 'started'),
      kpi('Match chat', num(r.match_chat ?? 0), 'messages'), kpi('Reports', num(r.reports ?? 0)),
      kpi('Feedback', num(r.feedback ?? 0), `${num(t.feedback_open)} not handled`), kpi('App errors', num(r.errors ?? 0))),
    el('div', { class: 'cols' },
      chartCard('New users per day', null, columnChart(a.daily, [{ key: 'users', name: 'New users', color: S1 }])),
      chartCard('Messages per day', null, lineChart(a.daily, 'messages', { name: 'Messages' }))),
    el('div', { class: 'cols mt' },
      chartCard('Games per day', null, columnChart(a.daily, [{ key: 'games', name: 'Games', color: S1 }])),
      chartCard('Match chat per day', null, columnChart(a.daily, [{ key: 'match_chat', name: 'Messages', color: S1 }]))),
    el('div', { class: 'cols mt' },
      chartCard('Games by type', null, dataTable([
        { key: 'kind', label: 'Game' }, { key: 'games', label: 'Started', num: true, fmt: num }, { key: 'finished', label: 'Finished', num: true, fmt: num },
      ], a.games_by_kind, { csv: 'games' })),
      chartCard('Busiest match chats', null, dataTable([
        { key: 'name', label: 'Match' }, { key: 'status', label: 'Status' },
        { key: 'messages', label: 'Messages', num: true, fmt: num }, { key: 'reported', label: 'Reported', num: true, fmt: num },
      ], a.sports.top_matches, { csv: 'match-chats' }))),
    el('div', { class: 'cols mt' },
      chartCard('App errors by screen', null, dataTable([
        { key: 'screen', label: 'Screen' }, { key: 'n', label: 'Errors', num: true, fmt: num }, { key: 'fatal', label: 'Crashes', num: true, fmt: num },
        { key: 'latest_version', label: 'Version' },
      ], a.errors_by_screen, { csv: 'errors', emptyText: 'No errors in this period. 🎉' })),
      chartCard('Feedback by type', null, dataTable([
        { key: 'category', label: 'Type' }, { key: 'n', label: 'Count', num: true, fmt: num },
      ], a.feedback_by_category, { csv: 'feedback' }))),
    chartCard('Every day', null, dataTable([
      { key: 'day', label: 'Day', fmt: (v) => dayLabel(v) },
      ...[['users', 'New users'], ['messages', 'Messages'], ['connections', 'New chats'], ['groups', 'Groups'], ['games', 'Games'],
        ['match_chat', 'Match chat'], ['reports', 'Reports'], ['feedback', 'Feedback'], ['errors', 'Errors']].map(([key, label]) => ({ key, label, num: true, fmt: num })),
    ], a.daily, { csv: 'app-daily', sortKey: 'day', limit: 31 })));
}
