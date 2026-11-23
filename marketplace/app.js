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

const ROWS = { national: 'National', regional: 'Regional (state)', local: 'Near you (city)' };
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
const indiaToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (d, n) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400e3).toISOString().slice(0, 10);
const when = (iso) => new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
const safeImg = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);
const where = (r) => (r.row_kind === 'national' ? '🇮🇳 National' : r.row_kind === 'regional' ? `🗺️ ${r.state}` : `📍 ${r.city}, ${r.state}`);

const ERRORS = {
  not_allowed: 'Not allowed.',
  not_authenticated: 'Please sign in again.',
  not_registered: 'Register your business first.',
  advertiser_not_approved: 'Your business account is not approved yet.',
  already_registered: 'This Google account is already registered.',
  accept_policy: 'Please accept the advertising rules.',
  signup_closed: 'New sign-ups are closed for now. Write to us.',
  state_unknown: 'Pick a state from the list.',
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
  bid_below_minimum: 'Your bid is below the lowest minimum price for that row.',
  bid_too_high: 'That amount is too high.',
  bid_not_found: 'Bid not found.',
  spot_taken: 'That spot is already booked for that day.',
  market_bookings_slot_idx: 'That spot is already booked for that day.',
  market_ads_check1: 'Website links must start with https://',
  market_ads_check: 'This button needs a value (link, phone, code or place).',
  market_advertisers_phone_check: 'Enter a valid phone number.',
  market_advertisers_gst_check: 'GST number looks wrong (15 characters).',
  market_advertisers_website_check: 'Website must start with https://',
  market_bookings_check: 'Regional needs a state; Near you needs a state and a city.',
  market_bids_check: 'Regional needs a state; Near you needs a state and a city.',
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
function field(label, input) { return el('div', {}, el('label', {}, label), input); }
function stateSelect(value) {
  return el('select', {}, el('option', { value: '' }, '— choose —'), (me?.states ?? []).map((s) => el('option', { value: s, selected: s === value }, s)));
}
function setStatus(text) { $('status').textContent = text ?? ''; $('status').classList.toggle('hidden', !text); }

/** Tabs: [{ key, label, render(container) }] */
function tabs(list, start) {
  const bar = el('div', { class: 'tabs' });
  const body = el('div');
  const open = (t) => {
    [...bar.children].forEach((b) => b.classList.toggle('on', b.dataset.key === t.key));
    fill(body, el('p', { class: 'small' }, 'Loading…'));
    Promise.resolve(t.render(body)).catch((e) => fill(body, el('p', { class: 'bad' }, errText(e))));
  };
  list.forEach((t) => bar.append(el('button', { 'data-key': t.key, onclick: () => open(t) }, t.label)));
  open(list.find((t) => t.key === start) ?? list[0]);
  return [bar, body];
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
// Start
// ---------------------------------------------------------------------------

async function main() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return landing();
  try {
    me = await rpc('market_whoami');
  } catch (e) {
    setStatus('');
    fill(root, el('div', { class: 'card' }, el('p', { class: 'bad' }, errText(e)),
      el('p', { class: 'small' }, 'If you are the owner: check that the Market SQL has been run in Supabase.'), signOutBtn()));
    return;
  }
  if (me.contact_email) { $('contactLink').textContent = me.contact_email; $('contactLink').href = 'mailto:' + me.contact_email; }
  setStatus('');
  const top = el('div', { class: 'row' }, el('h1', { class: 'grow', style: 'margin:0' }, me.is_admin ? 'Marketplace admin' : 'Marketplace'),
    el('span', { class: 'small' }, me.email ?? ''), signOutBtn());
  let view;
  if (me.is_admin) view = adminView();
  else if (!me.advertiser) view = registerView();
  else if (me.advertiser.status === 'approved') view = advertiserView();
  else view = waitingView();
  fill(root, top, ...[view].flat());
}

function signOutBtn() {
  return el('button', { class: 'secondary', onclick: async () => { await sb.auth.signOut(); location.reload(); } }, 'Sign out');
}

let started = false;
async function start() {
  if (started) return;
  started = true;
  await main();
}
sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_IN') { started = false; start(); } });
start();

// ---------------------------------------------------------------------------
// Signed out: what this is and how it works
// ---------------------------------------------------------------------------

function landing() {
  setStatus('');
  fill(root, 
    el('div', { class: 'hero' },
      el('h1', {}, 'Advertise on Pocketwave'),
      el('p', {}, 'Pocketwave has a Market tab with up to 30 hand-picked offers a day. People open it because they want to see today\'s deals. No ads in chats, no tracking, no clutter.')),
    el('div', { class: 'card' },
      el('h3', {}, 'Three rows, ten spots each'),
      el('ul', {},
        el('li', {}, el('strong', {}, 'National: '), 'everyone in India'),
        el('li', {}, el('strong', {}, 'Regional: '), 'people in one state'),
        el('li', {}, el('strong', {}, 'Near you: '), 'people in one city')),
      el('p', { class: 'small' }, 'Spot #1 is seen first and costs the most. New cards go live every day at midnight India time.')),
    el('div', { class: 'card' },
      el('h3', {}, 'How it works'),
      el('ol', { class: 'steps' },
        el('li', {}, 'Sign in with Google and register your business. We check every business before it can advertise.'),
        el('li', {}, 'Create your ad: picture, offer and a button (website, call, coupon code or directions). We review each ad.'),
        el('li', {}, 'Place a sealed bid for a day and a row. Nobody sees your bid. Bidding closes at 6 PM the day before.'),
        el('li', {}, 'Highest bids win the best spots. You pay just ₹1 more than the next bid, never more than what you offered.'),
        el('li', {}, 'See your views and taps after your day.'))),
    el('div', { class: 'card' },
      el('h3', {}, 'What we don\'t accept'),
      el('p', { class: 'small' }, 'Betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, and misleading offers.')),
    el('p', {}, el('button', { class: 'big', onclick: () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/marketplace/' } }) }, 'Continue with Google')),
    el('p', { class: 'small' }, 'Pocketwave admins sign in here too.'));
}

// ---------------------------------------------------------------------------
// Advertiser: register, waiting, main
// ---------------------------------------------------------------------------

function businessForm(a, { register }) {
  const f = {
    business_name: el('input', { maxlength: 80, value: a?.business_name ?? '', disabled: a && a.status === 'approved' }),
    contact_name: el('input', { maxlength: 60, value: a?.contact_name ?? '' }),
    phone: el('input', { maxlength: 16, value: a?.phone ?? '', placeholder: '+91 98400 00000' }),
    gst: el('input', { maxlength: 15, value: a?.gst ?? '', placeholder: 'Optional', disabled: a && a.status === 'approved' }),
    website: el('input', { value: a?.website ?? '', placeholder: 'https://… (optional)' }),
    address: el('input', { maxlength: 200, value: a?.address ?? '' }),
    state: stateSelect(a?.state),
    city: el('input', { maxlength: 40, value: a?.city ?? '' }),
  };
  const accept = el('input', { type: 'checkbox' });
  const save = el('button', {}, register ? 'Register' : 'Save details');
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
  return el('div', { class: 'card' },
    el('h3', {}, register ? 'Register your business' : 'Business details'),
    el('div', { class: 'grid' },
      field('Business name *', f.business_name), field('Contact person *', f.contact_name), field('Phone *', f.phone),
      field('GST number', f.gst), field('Website', f.website), field('Address', f.address), field('State', f.state), field('City', f.city)),
    register ? el('label', { class: 'check' }, accept,
      el('span', {}, 'My business and ads follow the rules: no betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, or misleading offers. I accept the ', el('a', { href: '/terms', target: '_blank', rel: 'noopener' }, 'Terms'), '.')) : null,
    el('p', {}, save));
}

function registerView() {
  if (!me.signup_open) return el('div', { class: 'card' }, el('p', {}, 'New advertiser sign-ups are closed for now. Write to us at ' + me.contact_email + '.'));
  return [el('p', {}, 'Welcome! Tell us about your business. We\'ll check it and approve your account, usually within a day.'), businessForm(null, { register: true })];
}

function waitingView() {
  const a = me.advertiser;
  const msg = {
    pending: ['⏳ We\'re reviewing your business', 'You\'ll be able to create ads and bid once approved. Keep your details up to date below.'],
    rejected: ['Your registration wasn\'t approved', 'Fix your details below and save to send it again.'],
    suspended: ['Your account is suspended', 'Write to us if you think this is a mistake.'],
  }[a.status] ?? ['', ''];
  return [
    el('div', { class: 'card' }, el('h3', {}, msg[0]), el('p', {}, msg[1]), a.admin_note ? el('p', { class: 'small' }, 'Note from us: ' + a.admin_note) : null),
    a.status === 'suspended' ? null : businessForm(a, { register: false }),
  ];
}

function advertiserView() {
  return [
    el('p', { class: 'small' }, `${me.advertiser.business_name} · approved advertiser`),
    ...tabs([
      { key: 'bid', label: 'Bid for a spot', render: advBid },
      { key: 'ads', label: 'My ads', render: advAds },
      { key: 'bids', label: 'My bids', render: advBids },
      { key: 'results', label: 'Results', render: advResults },
      { key: 'account', label: 'Account', render: (c) => fill(c, businessForm(me.advertiser, { register: false })) },
    ]),
  ];
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
  return el('div', { class: 'card' },
    el('h3', {}, ad ? 'Edit ad' : 'New ad'),
    !admin && ad ? el('p', { class: 'small warn' }, 'Saving any change sends the ad back for review.') : null,
    el('div', { class: 'grid' },
      admin ? field('Advertiser *', f.advertiser) : null, field('Title *', f.title), field('Category', f.category),
      admin ? field('Advertiser contact (only admins see this)', f.contact) : null),
    field('Offer text', f.offer),
    el('div', { class: 'grid' }, field('Button', f.action), field('Button value', f.action_value), field('Button text', f.action_label)),
    el('div', { class: 'grid' }, field('Picture (16:9, JPG/PNG/WebP, under 2 MB)', imgFile), field('Logo (square, optional)', logoFile)),
    preview,
    admin ? el('label', { class: 'check' }, approved, el('span', {}, 'Approved (only approved ads are shown or can bid)')) : null,
    el('p', { class: 'row' }, save, onSaved && ad ? el('button', { class: 'secondary', onclick: onSaved }, 'Cancel') : null),
    el('p', { class: 'small' }, 'Not allowed: betting, fantasy or real-money games, alcohol, tobacco, adult content, crypto or "get rich" schemes, misleading offers.'));
}

function adCard(a, buttons) {
  return el('div', { class: 'card' },
    el('div', { class: 'row' },
      safeImg(a.image_url) ? el('img', { class: 'thumb', src: a.image_url, alt: '' }) : null,
      el('div', { class: 'grow' },
        el('strong', {}, a.title),
        el('div', { class: 'small' }, [a.advertiser, a.category, ACTIONS[a.action] + (a.action_value ? ': ' + a.action_value : '')].filter(Boolean).join(' · ')),
        el('div', { class: 'small' }, `${a.views ?? 0} views · ${a.taps ?? 0} taps`)),
      el('span', { class: a.approved ? 'ok' : 'warn' }, a.approved ? 'Approved' : 'Waiting for review')),
    a.offer ? el('p', { class: 'small' }, a.offer) : null,
    a.review_note ? el('p', { class: 'small bad' }, 'Review note: ' + a.review_note) : null,
    el('div', { class: 'row' }, buttons));
}

async function advAds(c) {
  const ads = await rpc('market_adv_ads');
  const list = el('div');
  const formBox = el('div');
  const showForm = (ad) => { fill(formBox, adForm({ ad, admin: false, onSaved: () => advAds(c) })); formBox.scrollIntoView({ behavior: 'smooth' }); };
  fill(list, ...(ads.length ? ads.map((a) => adCard(a, [
    el('button', { class: 'secondary', onclick: () => showForm(a) }, 'Edit'),
    el('button', { class: 'danger', onclick: () => confirm('Delete this ad?') && act('market_adv_delete_ad', { p_id: a.id }, () => advAds(c), 'Deleted') }, 'Delete'),
  ])) : [el('p', { class: 'small' }, 'No ads yet. Create one below.')]));
  fill(formBox, adForm({ ad: null, admin: false, onSaved: () => advAds(c) }));
  fill(c, list, formBox);
}

// ---- Bidding ----

function regionInputs(onChange) {
  const row = el('select', {}, Object.entries(ROWS).map(([k, v]) => el('option', { value: k }, v)));
  const state = stateSelect(me.advertiser?.state);
  const city = el('input', { maxlength: 40, value: me.advertiser?.city ?? '', placeholder: 'Chennai' });
  const stateBox = field('State', state);
  const cityBox = field('City', city);
  const toggle = () => { stateBox.classList.toggle('hidden', row.value === 'national'); cityBox.classList.toggle('hidden', row.value !== 'local'); onChange?.(); };
  row.onchange = toggle;
  state.onchange = () => onChange?.();
  city.onchange = () => onChange?.();
  setTimeout(toggle);
  return { row, state, city, boxes: [field('Row', row), stateBox, cityBox],
    value: () => ({ p_row: row.value, p_state: row.value === 'national' ? null : state.value || null, p_city: row.value === 'local' ? city.value.trim() || null : null }) };
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
    if (r.p_row !== 'national' && !r.p_state) return fill(out, el('p', { class: 'small' }, 'Choose a state.'));
    if (r.p_row === 'local' && !r.p_city) return fill(out, el('p', { class: 'small' }, 'Enter a city.'));
    try {
      const m = await rpc('market_adv_market', { p_day: day.value, ...r });
      fill(out, marketPanel(m, ads, load));
    } catch (e) { fill(out, el('p', { class: 'bad' }, errText(e))); }
  };
  fill(c, 
    !me.bidding_open ? el('div', { class: 'card' }, el('strong', {}, 'Bidding opens soon.'), el('p', { class: 'small' }, 'You can already see prices and prepare your ads.')) : null,
    el('div', { class: 'card' }, el('div', { class: 'grid' }, field('Day', day), region.boxes), el('p', {}, el('button', { onclick: load }, 'Show spots'))),
    out);
  load();
}

function marketPanel(m, ads, reload) {
  const demand = { low: 'Low demand', medium: 'Medium demand', high: 'High demand' }[m.demand];
  const amount = el('input', { type: 'number', min: 1, value: m.my_bid?.amount_inr ?? '' });
  const adSel = el('select', {}, ads.length ? ads.map((a) => el('option', { value: a.id, selected: m.my_bid?.ad_id === a.id }, a.title)) : el('option', { value: '' }, 'No approved ads yet'));
  const lowest = Math.min(...m.positions.map((p) => p.min_price));
  const place = el('button', { disabled: !m.open || !ads.length }, m.my_bid ? 'Update my bid' : 'Place sealed bid');
  place.onclick = async () => {
    const amt = Number(amount.value);
    if (!amt) return toast('Enter an amount', true);
    if (!confirm(`Bid ${inr(amt)} for ${where(m)} on ${m.day}?\nYou pay only if you win, and never more than this.`)) return;
    place.disabled = true;
    await act('market_adv_bid', { p_day: m.day, p_row: m.row_kind, p_state: m.state, p_city: m.city, p_ad: adSel.value, p_amount: amt }, reload, 'Bid saved');
    place.disabled = false;
  };
  return el('div', {},
    el('div', { class: 'card' },
      el('div', { class: 'row' }, el('strong', {}, `${where(m)} · ${m.day}`), el('span', { class: 'grow' }),
        el('span', { class: 'demand-' + m.demand }, demand + (m.bids != null ? ` (${m.bids} bids)` : ''))),
      el('p', { class: 'small' }, m.open ? `Bidding closes ${when(m.deadline)}.` : 'Bidding is closed for this day.',
        m.special_day ? ` Special day ×${m.special_day.multiplier}${m.special_day.note ? ' (' + m.special_day.note + ')' : ''}.` : ''),
      el('table', { class: 'pos-table' },
        el('tr', {}, el('th', {}, 'Spot'), el('th', {}, 'Minimum'), el('th', {}, 'Typical winning price'), el('th', {}, 'Available')),
        m.positions.map((p) => el('tr', {}, el('td', {}, '#' + p.position), el('td', {}, inr(p.min_price)), el('td', {}, p.typical_price ? inr(p.typical_price) : '–'),
          el('td', { class: p.taken ? 'bad' : 'ok' }, p.taken ? 'Taken' : 'Open'))))),
    el('div', { class: 'card' },
      el('h3', {}, m.my_bid ? 'Your bid' : 'Place your bid'),
      el('div', { class: 'grid' }, field('Ad', adSel), field(`Most you'll pay for the day (at least ${inr(lowest)})`, amount)),
      el('p', { class: 'row' }, place,
        m.my_bid && m.open ? el('button', { class: 'secondary', onclick: () => confirm('Cancel your bid?') && act('market_adv_cancel_bid', { p_id: m.my_bid.id }, reload, 'Bid cancelled') }, 'Cancel bid') : null),
      el('p', { class: 'small' }, 'Bids are sealed: nobody else sees them. The highest bid gets the best free spot it can afford and pays ₹1 more than the next bid (at least the spot\'s minimum, never more than your bid).'),
      ads.length ? null : el('p', { class: 'small warn' }, 'Create an ad in "My ads". You can bid once we approve it.')));
}

async function advBids(c) {
  const bids = await rpc('market_adv_bids');
  const status = { open: ['Waiting', 'warn'], won: ['Won', 'ok'], lost: ['Not won', 'small'], cancelled: ['Cancelled', 'small'] };
  fill(c, ...(bids.length ? bids.map((b) => el('div', { class: 'card' },
    el('div', { class: 'row' }, el('strong', {}, `${b.day} · ${where(b)}`), el('span', { class: 'grow' }), el('span', { class: status[b.status][1] }, status[b.status][0])),
    el('div', { class: 'small' }, `Ad: ${b.ad_title} · your bid ${inr(b.amount_inr)}`,
      b.status === 'won' ? ` · spot #${b.won_position} · you pay ${inr(b.price_inr)}` : '',
      b.status === 'open' ? ` · closes ${when(b.deadline)}` : '', b.result ? ` · ${b.result}` : '')))
    : [el('p', { class: 'small' }, 'No bids yet.')]));
}

async function advResults(c) {
  const rows = await rpc('market_adv_results');
  const owed = rows.filter((r) => !r.paid).reduce((s, r) => s + (r.price_inr ?? 0), 0);
  fill(c, 
    owed ? el('div', { class: 'card' }, el('strong', {}, `To pay: ${inr(owed)}`), el('p', { class: 'small' }, me.payment_instructions)) : null,
    ...(rows.length ? rows.map((r) => el('div', { class: 'card' },
      el('div', { class: 'row' }, el('strong', {}, `${r.day} · ${where(r)} #${r.position}`), el('span', { class: 'grow' }),
        el('span', { class: r.paid ? 'ok' : 'warn' }, r.paid ? 'Paid' : 'Not paid'), el('strong', {}, inr(r.price_inr))),
      el('div', { class: 'small' }, `${r.ad_title} · 👁 ${r.views} views · 👆 ${r.taps} taps · ${r.views ? Math.round((r.taps / r.views) * 100) + '% tapped' : '–'}`)))
      : [el('p', { class: 'small' }, 'No spots yet. Results appear here once you win a spot.')]));
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

let cfg = null;
async function loadCfg() { cfg = await rpc('admin_market_config'); return cfg; }

function adminView() {
  return tabs([
    { key: 'day', label: 'Day', render: admDay },
    { key: 'advertisers', label: 'Advertisers', render: admAdvertisers },
    { key: 'ads', label: 'Ads', render: admAds },
    { key: 'book', label: 'Book a spot', render: admBook },
    { key: 'bids', label: 'Bids & auctions', render: admBids },
    { key: 'settings', label: 'Prices & settings', render: admSettings },
    { key: 'activity', label: 'Activity log', render: admActivity },
  ]);
}

async function admDay(c) {
  const pick = el('input', { type: 'date', value: c.dataset.day || indiaToday(), style: 'width:auto' });
  const out = el('div');
  const load = async () => {
    c.dataset.day = pick.value;
    const d = await rpc('admin_market_day', { p_day: pick.value });
    fill(out, 
      el('div', { class: 'card' },
        el('div', { class: 'row' }, el('strong', {}, d.day), el('span', { class: 'pill' }, `${d.booked} spots booked`),
          el('span', { class: 'pill' }, `auctions ${d.auctions_enabled ? 'ON' : 'off'}`), d.open_bids ? el('span', { class: 'pill' }, `${d.open_bids} open bids`) : null),
        el('p', { class: 'small' }, `Paid ${inr(d.revenue_paid)} · not paid yet ${inr(d.revenue_unpaid)}`, d.pending_approval ? ` · ${d.pending_approval} ad(s) waiting for review` : '')),
      ...(d.bookings.length ? d.bookings.map((b) => el('div', { class: 'card' },
        el('div', { class: 'row' }, el('strong', {}, `${where(b)} #${b.position}`), el('span', { class: 'grow' }),
          el('span', { class: b.paid ? 'ok' : 'warn' }, b.paid ? '✅ paid' : '⏳ not paid'), el('strong', {}, inr(b.price_inr))),
        el('div', {}, `${b.advertiser} – ${b.title}`, b.approved ? '' : el('span', { class: 'bad' }, '  (ad not approved: hidden)')),
        el('div', { class: 'small' }, `👁 ${b.views} views · 👆 ${b.taps} taps · ${b.views ? Math.round((b.taps / b.views) * 100) + '% tap rate' : '–'}`),
        el('div', { class: 'row', style: 'margin-top:8px' },
          el('button', { class: 'secondary', onclick: () => act('admin_market_update_booking', { p_id: b.id, p_paid: !b.paid }, load) }, b.paid ? 'Mark not paid' : 'Mark paid'),
          el('button', { class: 'danger', onclick: () => confirm('Remove this booking?') && act('admin_market_delete_booking', { p_id: b.id }, load, 'Removed') }, 'Remove'))))
        : [el('p', { class: 'small' }, 'No bookings this day. Empty spots show Pocketwave\'s own cards.')]));
  };
  pick.onchange = load;
  fill(c, el('div', { class: 'row' }, pick, el('button', { class: 'secondary', onclick: () => { pick.value = indiaToday(); load(); } }, 'Today'),
    el('button', { class: 'secondary', onclick: load }, 'Refresh')), out);
  await load();
}

async function admAdvertisers(c) {
  const list = await rpc('admin_market_advertisers');
  const statusClass = { pending: 'warn', approved: 'ok', rejected: 'bad', suspended: 'bad' };
  const set = (a, status) => {
    const note = status === 'approved' ? null : prompt(`Note to ${a.business_name} (they will see it):`, a.admin_note ?? '');
    if (status !== 'approved' && note === null) return;
    act('admin_market_set_advertiser', { p_id: a.id, p_status: status, p_note: note }, () => admAdvertisers(c));
  };
  fill(c, ...(list.length ? list.map((a) => el('div', { class: 'card' },
    el('div', { class: 'row' }, el('strong', {}, a.business_name), el('span', { class: 'grow' }), el('span', { class: statusClass[a.status] }, a.status.toUpperCase())),
    el('div', { class: 'small' }, [a.contact_name, a.phone, a.email, a.gst ? 'GST ' + a.gst : null, [a.city, a.state].filter(Boolean).join(', '), a.website].filter(Boolean).join(' · ')),
    a.address ? el('div', { class: 'small' }, a.address) : null,
    el('div', { class: 'small' }, `${a.ads} ads (${a.pending_ads} waiting) · paid ${inr(a.spent)} · owed ${inr(a.owed)} · registered ${when(a.created_at)}`),
    a.admin_note ? el('div', { class: 'small' }, 'Note: ' + a.admin_note) : null,
    el('div', { class: 'row', style: 'margin-top:8px' },
      a.status !== 'approved' ? el('button', { onclick: () => set(a, 'approved') }, 'Approve') : null,
      a.status === 'pending' ? el('button', { class: 'secondary', onclick: () => set(a, 'rejected') }, 'Reject') : null,
      a.status === 'approved' ? el('button', { class: 'danger', onclick: () => set(a, 'suspended') }, 'Suspend') : null)))
    : [el('p', { class: 'small' }, 'No advertisers have registered yet.')]));
}

async function admAds(c) {
  const ads = await rpc('admin_market_ads');
  const formBox = el('div');
  const showForm = (ad) => { fill(formBox, adForm({ ad, admin: true, onSaved: () => admAds(c) })); formBox.scrollIntoView({ behavior: 'smooth' }); };
  const review = (a, ok) => {
    const note = ok ? null : prompt('Why is it not approved? (the advertiser will see this)', '');
    if (!ok && note === null) return;
    act('admin_market_review_ad', { p_id: a.id, p_approved: ok, p_note: note }, () => admAds(c));
  };
  const waiting = ads.filter((a) => !a.approved);
  fill(c, 
    waiting.length ? el('h3', {}, `Waiting for review (${waiting.length})`) : null,
    ...waiting.map((a) => adCard(a, [
      el('button', { onclick: () => review(a, true) }, 'Approve'),
      el('button', { class: 'secondary', onclick: () => review(a, false) }, 'Not approved'),
      el('button', { class: 'secondary', onclick: () => showForm(a) }, 'Edit')])),
    el('h3', {}, 'All ads'),
    ...ads.filter((a) => a.approved).map((a) => adCard(a, [
      el('button', { class: 'secondary', onclick: () => showForm(a) }, 'Edit'),
      el('button', { class: 'secondary', onclick: () => review(a, false) }, 'Unapprove'),
      el('button', { class: 'danger', onclick: () => confirm('Delete this ad and all its bookings and bids?') && act('admin_market_delete_ad', { p_id: a.id }, () => admAds(c), 'Deleted') }, 'Delete')])),
    formBox);
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
  const save = el('button', {}, 'Book');
  save.onclick = () => {
    if (!ad.value) return toast('Approve an ad first', true);
    const r = region.value();
    act('admin_market_book', { p_day: day.value, p_position: Number(pos.value), p_ad: ad.value, ...r, p_price: price.value ? Number(price.value) : null }, null, 'Booked');
  };
  fill(c, el('div', { class: 'card' }, el('h3', {}, 'Book a spot at a fixed price'),
    el('div', { class: 'grid' }, field('Day', day), region.boxes, field('Position', pos), field('Ad', ad), field('Price ₹', price)), hint, el('p', {}, save)));
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
  const load = async () => {
    c.dataset.day = day.value;
    const bids = await rpc('admin_market_bids', { p_day: day.value });
    fill(list, ...(bids.length ? bids.map((b) => el('div', { class: 'card' },
      el('div', { class: 'row' }, el('strong', {}, `${where(b)} · ${b.advertiser} – ${b.title}`), el('span', { class: 'grow' }),
        el('span', { class: b.status === 'won' ? 'ok' : b.status === 'open' ? 'warn' : 'small' }, b.status.toUpperCase())),
      el('div', { class: 'small' }, `Bid ${inr(b.amount_inr)}`, b.status === 'won' ? ` · won #${b.won_position} · pays ${inr(b.price_inr)}` : '', b.note ? ` · ${b.note}` : '',
        b.advertiser_id ? ' · placed by advertiser' : ' · added by admin'),
      b.status === 'open' ? el('div', { style: 'margin-top:8px' }, el('button', { class: 'secondary', onclick: () => act('admin_market_cancel_bid', { p_id: b.id }, load, 'Cancelled') }, 'Cancel bid')) : null))
      : [el('p', { class: 'small' }, 'No bids for this day.')]));
  };
  day.onchange = load;
  const s = cfg.settings;
  fill(c, 
    el('div', { class: 'card' },
      el('div', { class: 'row' }, day, el('button', { class: 'secondary', onclick: load }, 'Refresh'), el('span', { class: 'grow' }),
        el('button', { onclick: () => confirm(`Close all open bids for ${day.value} now? Winners get booked.`) && act('admin_market_run_auctions', { p_day: day.value }, load, 'Auctions closed') }, 'Run auctions for this day now')),
      el('p', { class: 'small' }, `Advertiser bidding: ${s.advertiser_bidding_open ? 'OPEN' : 'closed'} · automatic auctions: ${s.auctions_enabled ? `ON (close daily at ${s.auction_close_hour_ist}:00)` : 'off'}`)),
    el('div', { class: 'card' }, el('h3', {}, 'Add a bid (testing, or from an email)'),
      el('div', { class: 'grid' }, region.boxes, field('Ad', ad), field('Most they\'ll pay ₹', amount)),
      el('p', {}, el('button', { onclick: () => {
        if (!ad.value) return toast('Approve an ad first', true);
        if (!Number(amount.value)) return toast('Enter an amount', true);
        act('admin_market_add_bid', { p_day: day.value, p_ad: ad.value, p_amount: Number(amount.value), ...region.value() }, () => { amount.value = ''; return load(); }, 'Bid added');
      } }, 'Add bid'))),
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
  const prices = el('table', {}, el('tr', {}, el('th', {}, 'Spot'), Object.values(ROWS).map((r) => el('th', {}, r))),
    Array.from({ length: 10 }, (_, i) => el('tr', {}, el('td', {}, '#' + (i + 1)), Object.keys(ROWS).map((k) => {
      const p = cfg.prices.find((x) => x.row_kind === k && x.position === i + 1);
      const inp = el('input', { type: 'number', min: 0, value: p?.price_inr ?? 0 });
      inp.onchange = () => act('admin_market_set_price', { p_row: k, p_position: i + 1, p_price: Number(inp.value) });
      return el('td', {}, inp);
    }))));
  const spDay = el('input', { type: 'date' }), spMult = el('input', { type: 'number', step: 0.5, min: 1, max: 10, value: 2 }), spNote = el('input', { placeholder: 'IPL final' });
  fill(c, 
    el('div', { class: 'card' }, el('h3', {}, 'Switches'),
      el('label', { class: 'check' }, signup, el('span', {}, 'Businesses can register')),
      el('label', { class: 'check' }, bidding, el('span', {}, 'Approved advertisers can place bids')),
      el('label', { class: 'check' }, auctions, el('span', {}, 'Close auctions automatically every evening for the next day')),
      el('label', { class: 'check' }, exact, el('span', {}, 'Show advertisers the exact number of bids (otherwise Low / Medium / High demand)')),
      el('div', { class: 'grid' }, field('Contact email shown in the app and here', email), field('Bidding closes at (hour, India time, day before)', hour), field('Max spots per advertiser per row', cap)),
      field('Payment instructions shown to winners', pay),
      el('p', {}, el('button', { onclick: save }, 'Save settings'))),
    el('div', { class: 'card' }, el('h3', {}, 'Price list (₹ per day): also the minimum bid'), prices, el('p', { class: 'small' }, 'Each box saves when you leave it.')),
    el('div', { class: 'card' }, el('h3', {}, 'Special days (prices multiply)'),
      el('div', { class: 'grid' }, field('Day', spDay), field('Multiplier', spMult), field('Note', spNote)),
      el('p', {}, el('button', { onclick: () => spDay.value ? act('admin_market_special_day', { p_day: spDay.value, p_multiplier: Number(spMult.value), p_note: spNote.value.trim() || null }, () => admSettings(c)) : toast('Pick a day', true) }, 'Add special day')),
      ...(cfg.special_days.length ? cfg.special_days.map((d) => el('div', { class: 'row', style: 'margin:6px 0' }, el('span', {}, `${d.day} · ×${d.multiplier}${d.note ? ' · ' + d.note : ''}`),
        el('button', { class: 'secondary', onclick: () => act('admin_market_special_day', { p_day: d.day, p_multiplier: null }, () => admSettings(c), 'Removed') }, 'Remove')))
        : [el('p', { class: 'small' }, 'No special days coming up.')])));
}

async function admActivity(c) {
  const rows = await rpc('admin_market_audit', { p_limit: 300 });
  const names = { market_ads: 'ad', market_bookings: 'booking', market_bids: 'bid', market_advertisers: 'advertiser', market_prices: 'price',
    market_settings: 'settings', market_special_days: 'special day', market_house_cards: 'house card' };
  const verbs = { INSERT: 'added', UPDATE: 'changed', DELETE: 'removed' };
  fill(c, el('p', { class: 'small' }, 'Every change to the Market, newest first. Kept for one year.'),
    el('table', {}, el('tr', {}, el('th', {}, 'When'), el('th', {}, 'Who'), el('th', {}, 'What')),
      rows.map((r) => el('tr', {}, el('td', {}, when(r.at)), el('td', {}, r.who), el('td', {}, `${verbs[r.op] ?? r.op} ${names[r.tbl] ?? r.tbl}`)))));
}
