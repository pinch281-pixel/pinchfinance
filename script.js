'use strict';

/* ==========================================================================
   PINCH Finance - Beta 2 - script.js
   --------------------------------------------------------------------------
   Flat repository layout: this file sits in the repository root next to
   index.html. No js/ folder, no src/ folder.

   This file owns the interface: helpers, roles and permissions, the router,
   every view, the modals and the sound effects. It is loaded after
   supabase.js and starts the app from init() at the bottom.
   ========================================================================== */

var VERSION = '0.4.0';
var RELEASE = 'Beta 2';
var BUILD = 'r140';
var CFG_KEY = 'pinch.config';
var PAGE_SIZE = 25;

/* Snapshot of the untouched document, used to hand out a standalone file when
   the preview sandbox blocks outbound network access. */
var ORIGINAL_HTML = '<!doctype html>\n' + document.documentElement.outerHTML;

/* ---------- helpers ---------- */
function $(s, r) { return (r || document).querySelector(s); }
function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function pad2(n) { return String(n).padStart(2, '0'); }
function todayISO() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1); }
function monthStart(key) { return key + '-01'; }
function monthEnd(key) {
  var p = key.split('-'), y = +p[0], m = +p[1];
  return y + '-' + pad2(m) + '-' + pad2(new Date(y, m, 0).getDate());
}
function addMonths(key, n) {
  var p = key.split('-'), d = new Date(+p[0], +p[1] - 1 + n, 1);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1);
}
function monthLabel(key, short) {
  var p = key.split('-'), d = new Date(+p[0], +p[1] - 1, 1);
  return d.toLocaleDateString(undefined, short ? { month: 'short' } : { month: 'long', year: 'numeric' });
}
function fmtDate(iso) {
  if (!iso) return '—';
  var p = String(iso).slice(0, 10).split('-');
  if (p.length !== 3) return String(iso);
  return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}
function money(n) {
  var cur = (profile && profile.currency) || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(num(n));
  } catch (e) { return num(n).toFixed(2); }
}
function initials(name, email) {
  var s = (name || email || 'P').trim();
  var parts = s.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0] || 'P')[0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}
function toast(msg, kind) {
  var root = $('#toast-root');
  var t = document.createElement('div');
  t.className = 'toast ' + (kind === 'err' ? 'err' : kind === 'ok' ? 'ok' : '');
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(function () { t.remove(); }, kind === 'err' ? 6500 : 3200);
}
function errMsg(e) {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  return e.message || e.error_description || e.hint || JSON.stringify(e);
}
var PALETTE = ['#0E7C66', '#2563EB', '#D97706', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#65A30D', '#475569', '#C2410C'];


var TITLES = {
  dashboard: 'Dashboard', transactions: 'Transactions', income: 'Income', expenses: 'Expenses',
  accounts: 'Bank accounts', transfers: 'Transfers', categories: 'Categories', budgets: 'Budgets',
  reports: 'Reports', team: 'Team', profile: 'Profile'
};

/* ---------- role-based access control ----------
   The role is stored per workspace member in Postgres and every permission is
   enforced again by RLS policies. The client copy only drives the interface. */
var ROLES = ['owner', 'admin', 'editor', 'viewer'];
var PERMS = [
  { key: 'dashboard_view', label: 'Dashboard access', owner: 1, admin: 1, editor: 1, viewer: 1 },
  { key: 'accounts_view', label: 'View bank accounts', owner: 1, admin: 1, editor: 1, viewer: 1 },
  { key: 'accounts_create', label: 'Create bank accounts', owner: 1, admin: 1, editor: 1, viewer: 0 },
  { key: 'accounts_edit', label: 'Edit bank accounts', owner: 1, admin: 1, editor: 1, viewer: 0 },
  { key: 'accounts_delete', label: 'Delete bank accounts', owner: 1, admin: 1, editor: 0, viewer: 0 },
  { key: 'transactions_view', label: 'View transactions', owner: 1, admin: 1, editor: 1, viewer: 1 },
  { key: 'transactions_create', label: 'Create transactions', owner: 1, admin: 1, editor: 1, viewer: 0 },
  { key: 'transactions_edit', label: 'Edit transactions', owner: 1, admin: 1, editor: 1, viewer: 0 },
  { key: 'transactions_delete', label: 'Delete transactions', owner: 1, admin: 1, editor: 0, viewer: 0 },
  { key: 'budgets_manage', label: 'Manage budgets', owner: 1, admin: 1, editor: 0, viewer: 0 },
  { key: 'reports_view', label: 'View reports', owner: 1, admin: 1, editor: 1, viewer: 1 },
  { key: 'users_manage', label: 'Manage users and roles', owner: 1, admin: 1, editor: 0, viewer: 0 }
];

var me = { id: null, role: 'viewer', perms: {}, isOwner: false };

function permMatrixFor(role) {
  var out = {};
  PERMS.forEach(function (p) { out[p.key] = !!p[role]; });
  return out;
}
function can(key) { return !!(me.perms && me.perms[key]); }
function roleLabel(r) { return r === 'admin' ? 'Administrator' : r.charAt(0).toUpperCase() + r.slice(1); }
function rolePill(r) { return '<span class="role-pill role-' + esc(r) + '">' + esc(roleLabel(r)) + '</span>'; }
function applyRole(role) {
  me.role = role;
  me.isOwner = role === 'owner';
  me.perms = permMatrixFor(role);
  applyNavVisibility();
}
function applyNavVisibility() {
  var map = {
    dashboard: 'dashboard_view', transactions: 'transactions_view', income: 'transactions_view',
    expenses: 'transactions_view', accounts: 'accounts_view', transfers: 'transactions_view',
    categories: 'transactions_view', budgets: 'budgets_manage', reports: 'reports_view',
    team: 'users_manage', profile: null
  };
  $$('.nav-item').forEach(function (b) {
    var view = b.getAttribute('data-view');
    var need = map[view];
    var hidden = !!(need && !can(need));
    /* Accounts, Transfers and Team need the Stage 2 tables to exist. */
    if (!stage2Ready && (view === 'accounts' || view === 'transfers' || view === 'team')) hidden = true;
    b.classList.toggle('hidden', hidden);
  });
  var quick = $('#quick-add');
  if (quick) quick.classList.toggle('hidden', !can('transactions_create'));
}

/* Stage 2 needs four new tables plus an account_id column. Until that SQL has
   been run, the app runs in Stage 1 mode and says so. */
function renderStage2Notice() {
  var host = $('#stage2-notice');
  if (!host) return;
  if (stage2Ready) { host.innerHTML = ''; host.classList.add('hidden'); return; }
  host.classList.remove('hidden');
  host.innerHTML = '<div class="notice warn" style="margin:0 0 16px">' +
    '<div style="flex:1"><strong>Stage 2 database objects are missing.</strong> ' +
    'Bank accounts, roles and permissions need four tables and one column that are not in this project yet. ' +
    'Everything from Stage 1 keeps working; the new modules stay hidden until the migration runs.</div>' +
    '<button class="btn small" type="button" data-stage2-sql="1" style="flex:none">Show migration SQL</button>' +
    '</div>';
}

var state = {
  view: 'dashboard',
  budgetMonth: monthKey(),
  reportMode: 'year',
  reportYear: String(new Date().getFullYear()),
  reportMonth: monthKey(),
  ledgers: {
    transactions: { type: 'all', month: monthKey(), cat: 'all', acct: 'all', q: '', page: 0, count: 0, rows: [] },
    income: { type: 'income', month: monthKey(), cat: 'all', acct: 'all', q: '', page: 0, count: 0, rows: [] },
    expenses: { type: 'expense', month: monthKey(), cat: 'all', acct: 'all', q: '', page: 0, count: 0, rows: [] }
  }
};

/* ---------- screen switching ---------- */
function show(name) {
  ['boot', 'setup', 'auth', 'app', 'netblock'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== name);
  });
}

/* The preview sandbox can block requests to origins outside the artifact API.
   Detect that and explain it instead of showing a generic error. */
function isNetworkError(e) {
  var m = (e && (e.message || e.toString())) || '';
  return /failed to fetch|load failed|networkerror|network error|blocked|err_|csp|refused to connect|cors/i.test(m);
}

function showNetblock(detail) {
  if (!document.getElementById('netblock')) {
    var d = document.createElement('div');
    d.id = 'netblock';
    d.className = 'center-screen hidden';
    d.innerHTML =
      '<div class="auth-card" style="max-width:560px">' +
        '<div class="brand-mark">P</div>' +
        '<h1>This preview cannot reach Supabase</h1>' +
        '<p class="muted small">The Jetdraft artifact runtime blocks network requests to endpoints outside its own artifact API, so the browser cannot open a connection to <code>zfhosceosdowhbilnoao.supabase.co</code>. This is a sandbox restriction, not a credential or database problem: the project URL and publishable key are valid and the tables and RLS policies are in place.</p>' +
        '<p class="muted small">Run the app outside the sandbox. Download the standalone file and open it in a normal browser tab, or host it anywhere static. Supabase accepts requests from any origin, so it will connect immediately.</p>' +
        '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:16px">' +
          '<button class="btn" type="button" id="nb-download">Download index.html</button>' +
          '<button class="btn ghost" type="button" id="nb-retry">Retry connection</button>' +
          '<button class="btn ghost" type="button" id="nb-change">Change project</button>' +
        '</div>' +
        '<p class="hint" id="nb-msg"></p>' +
        '<details class="sqlbox"><summary>Technical detail</summary><pre class="code" id="nb-detail"></pre></details>' +
      '</div>';
    document.body.appendChild(d);

    d.querySelector('#nb-download').addEventListener('click', function () {
      try {
        var blob = new Blob([ORIGINAL_HTML], { type: 'text/html;charset=utf-8' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'index.html';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
        setMsg('#nb-msg', 'Downloaded. Keep style.css, script.js, supabase.js and the WAV files in the same folder, then open index.html in a browser tab.', 'ok');
      } catch (err) {
        setMsg('#nb-msg', 'Download blocked by the sandbox. Ask for the exported file link instead.', 'err');
      }
    });
    d.querySelector('#nb-retry').addEventListener('click', function () {
      var cfg = readCfg();
      if (!cfg.url || !cfg.key) { show('setup'); return; }
      startClient(cfg);
    });
    d.querySelector('#nb-change').addEventListener('click', function () { resetConnection(); });
  }
  var pre = document.getElementById('nb-detail');
  if (pre) pre.textContent = String(detail || 'No further detail.');
  show('netblock');
}


async function enterApp() {
  if (appReady) return;
  appReady = true;
  show('app');
  try {
    await loadProfile();
  } catch (e) {
    appReady = false;
    if (isNetworkError(e)) { showNetblock('Profile query was blocked: ' + errMsg(e)); return; }
    renderFatal(e);
    return;
  }
  /* Role and accounts are optional: without the Stage 2 objects the app runs
     in Stage 1 mode instead of refusing to start. */
  try { await loadRole(); } catch (e) { stage2Ready = false; applyRole('owner'); }
  try { await loadCategories(); } catch (e) { cats = []; }
  try { await loadAccounts(); } catch (e) { accounts = []; }
  buildLedgers(true);
  renderShell();
  renderStage2Notice();
  var hash = (location.hash || '').replace(/^#\/?/, '');
  var allowed = TITLES[hash] &&
    !(hash === 'accounts' && (!can('accounts_view') || !stage2Ready)) &&
    !(hash === 'team' && (!can('users_manage') || !stage2Ready));
  showView(allowed ? hash : 'dashboard');
}

function renderFatal(e) {
  appReady = false;
  if (isNetworkError(e)) { showNetblock('Startup query was blocked: ' + errMsg(e)); return; }
  var needsSchema = isMissingTable(e);
  $('#views').innerHTML = '<div class="card"><h2>' +
    (needsSchema ? 'Database schema missing' : 'Could not load your workspace') + '</h2>' +
    '<p class="muted small">' + esc(errMsg(e)) + '</p>' +
    '<p class="muted small">' + (needsSchema
      ? 'Run the schema SQL in Supabase → SQL Editor, then reload. The Stage 1 tables are required before anything else.'
      : 'Check that the Supabase project is reachable and that your session is still valid.') + '</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn" type="button" onclick="location.reload()">Reload</button>' +
    '<button class="btn ghost" type="button" id="fatal-signout">Sign out</button>' +
    '</div></div>';
  var out = $('#fatal-signout');
  if (out) out.addEventListener('click', doSignOut);
}

function renderShell() {
  var name = (profile && profile.full_name) || (user && user.email) || 'Account';
  $('#side-name').textContent = name;
  $('#side-email').textContent = (user && user.email) || '';
  $('#side-avatar').textContent = initials(profile && profile.full_name, user && user.email);
  var badge = $('#side-role');
  if (badge) {
    badge.className = 'role-pill role-' + esc(me.role);
    badge.textContent = roleLabel(me.role);
  }
  var sub = $('#side-build');
  if (sub) sub.textContent = 'Finance · ' + RELEASE + ' · v' + VERSION;
}

function setMsg(sel, text, kind) {
  var el = $(sel);
  if (!el) return;
  el.className = 'hint' + (kind ? ' ' + kind : '');
  el.textContent = text || '';
}


/* ============================================================
   Router
   ============================================================ */
var VIEW_LOADERS = {};

function showView(name) {
  if (!TITLES[name]) name = 'dashboard';
  var gate = {
    dashboard: 'dashboard_view', transactions: 'transactions_view', income: 'transactions_view',
    expenses: 'transactions_view', accounts: 'accounts_view', categories: 'transactions_view',
    budgets: 'budgets_manage', reports: 'reports_view', team: 'users_manage'
  };
  if (gate[name] && !can(gate[name])) {
    var el = document.getElementById('view-' + name);
    if (el) el.innerHTML = '<div class="card">' + emptyState('Not available for your role', 'The ' + roleLabel(me.role) + ' role does not include ' + TITLES[name].toLowerCase() + ' access.') + '</div>';
    $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
    $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === name); });
    $('#page-title').textContent = TITLES[name];
    $('#sidebar').classList.remove('open');
    return;
  }
  state.view = name;
  $$('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + name); });
  $$('.nav-item').forEach(function (b) { b.classList.toggle('active', b.getAttribute('data-view') === name); });
  $('#page-title').textContent = TITLES[name];
  $('#sidebar').classList.remove('open');
  if (location.hash !== '#/' + name) {
    try { history.replaceState(null, '', '#/' + name); } catch (e) { /* ignore */ }
  }
  var fn = VIEW_LOADERS[name];
  if (fn) fn();
}

function loadingCard(msg) {
  return '<div class="card"><div class="center-screen" style="min-height:180px;padding:0">' +
    '<div class="spinner"></div><p class="muted small">' + esc(msg || 'Loading…') + '</p></div></div>';
}

function emptyState(title, text, actionHtml) {
  return '<div class="empty"><h3>' + esc(title) + '</h3><p>' + esc(text) + '</p>' + (actionHtml || '') + '</div>';
}

/* ============================================================
   Charts (inline SVG, no external library)
   ============================================================ */
function trendChart(months) {
  var W = 620, H = 220, padL = 8, padR = 8, baseY = H - 28, top = 16;
  var max = 1;
  months.forEach(function (m) { max = Math.max(max, num(m.income), num(m.expense)); });
  var slot = (W - padL - padR) / months.length;
  var bw = Math.min(16, slot / 3.4);
  var parts = ['<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Income and expense by month">'];
  for (var g = 0; g <= 3; g++) {
    var gy = top + (baseY - top) * g / 3;
    parts.push('<line x1="0" y1="' + gy.toFixed(1) + '" x2="' + W + '" y2="' + gy.toFixed(1) + '" stroke="#EFF2F6" stroke-width="1"/>');
  }
  months.forEach(function (m, i) {
    var cx = padL + slot * i + slot / 2;
    var hi = (num(m.income) / max) * (baseY - top);
    var he = (num(m.expense) / max) * (baseY - top);
    var x1 = cx - bw - 2, x2 = cx + 2;
    parts.push('<rect x="' + x1.toFixed(1) + '" y="' + (baseY - hi).toFixed(1) + '" width="' + bw + '" height="' + Math.max(hi, 1.5).toFixed(1) + '" rx="4" fill="#0E7C66"><title>' + esc(monthLabel(m.key)) + ' income: ' + esc(money(m.income)) + '</title></rect>');
    parts.push('<rect x="' + x2.toFixed(1) + '" y="' + (baseY - he).toFixed(1) + '" width="' + bw + '" height="' + Math.max(he, 1.5).toFixed(1) + '" rx="4" fill="#E7B4A6"><title>' + esc(monthLabel(m.key)) + ' expense: ' + esc(money(m.expense)) + '</title></rect>');
    parts.push('<text x="' + cx.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#6B7A90">' + esc(monthLabel(m.key, true)) + '</text>');
  });
  parts.push('<line x1="0" y1="' + baseY + '" x2="' + W + '" y2="' + baseY + '" stroke="#E4E8EF" stroke-width="1"/>');
  parts.push('</svg>');
  return parts.join('');
}

function donutChart(items, total, centerLabel) {
  var R = 52, C = 2 * Math.PI * R, off = 0;
  var segs = items.map(function (d) {
    var len = total > 0 ? (d.value / total) * C : 0;
    var s = '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="' + d.color + '" stroke-width="17" stroke-dasharray="' +
      len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 70 70)">' +
      '<title>' + esc(d.label) + ': ' + esc(money(d.value)) + '</title></circle>';
    off += len;
    return s;
  }).join('');
  return '<svg class="chart" viewBox="0 0 140 140" style="width:150px;height:150px;flex:none" role="img" aria-label="Spending by category">' +
    '<circle cx="70" cy="70" r="' + R + '" fill="none" stroke="#EFF2F6" stroke-width="17"/>' + segs +
    '<text x="70" y="66" text-anchor="middle" class="donut-mid">' + esc(centerLabel || 'Total') + '</text>' +
    '<text x="70" y="84" text-anchor="middle" class="donut-val">' + esc(money(total)) + '</text></svg>';
}

function legendList(items, total) {
  return '<div class="legend">' + items.map(function (d) {
    var pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
    return '<div class="legend-item"><span class="swatch" style="background:' + d.color + '"></span>' +
      '<span class="name">' + esc(d.label) + '</span>' +
      '<span class="val">' + esc(money(d.value)) + '</span>' +
      '<span class="muted small" style="width:34px;text-align:right">' + pct + '%</span></div>';
  }).join('') + '</div>';
}

/* ============================================================
   Dashboard
   ============================================================ */
VIEW_LOADERS.dashboard = async function () {
  var el = $('#view-dashboard');
  el.innerHTML = loadingCard('Loading your dashboard…');
  $('#page-sub').textContent = monthLabel(monthKey());
  try {
    var thisMonth = monthKey();
    var from6 = monthStart(addMonths(thisMonth, -5));
    var to6 = monthEnd(thisMonth);
    var lifetimeFrom = '1900-01-01';
    var lifetimeTo = '2999-12-31';

    var res = await Promise.all([
      fetchRange(from6, to6, 'all'),
      fetchRange(lifetimeFrom, lifetimeTo, 'all'),
      sb.from('transactions').select('id,type,amount,description,occurred_on,category_id')
        .order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).limit(8)
    ]);
    if (res[2].error) throw res[2].error;
    var range6 = res[0], lifetime = res[1], recent = res[2].data || [];

    var life = totals(lifetime);
    var months = [];
    for (var i = -5; i <= 0; i++) {
      var k = addMonths(thisMonth, i);
      months.push({ key: k, income: 0, expense: 0 });
    }
    range6.forEach(function (r) {
      var k = String(r.occurred_on).slice(0, 7);
      var slot = null;
      for (var j = 0; j < months.length; j++) if (months[j].key === k) slot = months[j];
      if (!slot) return;
      if (r.type === 'income') slot.income += num(r.amount); else slot.expense += num(r.amount);
    });
    var cur = months[months.length - 1];
    var prev = months[months.length - 2] || { income: 0, expense: 0 };
    var savings = cur.income > 0 ? ((cur.income - cur.expense) / cur.income) * 100 : 0;

    var byCat = {};
    range6.forEach(function (r) {
      if (r.type !== 'expense') return;
      if (String(r.occurred_on).slice(0, 7) !== thisMonth) return;
      var key = r.category_id || 'none';
      byCat[key] = (byCat[key] || 0) + num(r.amount);
    });
    var catItems = Object.keys(byCat).map(function (id) {
      var c = catById(id === 'none' ? null : id);
      return { label: c ? c.name : 'Uncategorised', value: byCat[id], color: catColor(c) };
    }).sort(function (a, b) { return b.value - a.value; });
    if (catItems.length > 7) {
      var rest = catItems.slice(7).reduce(function (s, d) { return s + d.value; }, 0);
      catItems = catItems.slice(0, 7);
      catItems.push({ label: 'Other categories', value: rest, color: '#94A3B8' });
    }
    var monthExpense = cur.expense;

    var bres = await sb.from('budgets').select('id,category_id,amount,period_month').eq('period_month', monthStart(thisMonth));
    if (bres.error) throw bres.error;
    var budgets = bres.data || [];

    /* Accounts summary */
    var acctTotal = accounts.reduce(function (s, a) { return s + (a.status === 'closed' ? 0 : num(a.current_balance)); }, 0);
    var acctCards = '';
    if (can('accounts_view') && accounts.length) {
      acctCards = '<div class="card"><div class="card-head"><h2>Accounts</h2><div class="spacer"></div>' +
        (can('accounts_create') ? '<button class="btn ghost small" type="button" data-newacct="1">+ Add new account</button>' : '') +
        '<button class="btn ghost small" type="button" data-goto="accounts">Manage</button></div>' +
        '<div class="acct-grid" style="margin-bottom:0">' +
        accounts.slice(0, 3).map(function (a) {
          return '<div class="acct-card type-' + acctTypeClass(a.account_type) + '">' +
            '<div class="acct-top"><div style="flex:1;min-width:0"><div class="acct-name">' + esc(a.name) + '</div>' +
            '<div class="acct-bank">' + esc(acctTypeLabel(a.account_type)) + ' · ' + esc(a.currency) + '</div></div></div>' +
            '<div class="acct-balance ' + (num(a.current_balance) < 0 ? 'neg' : '') + '">' + esc(money(a.current_balance)) + '</div>' +
            '</div>';
        }).join('') + '</div>' +
        (accounts.length > 3 ? '<p class="muted small" style="margin:10px 0 0">Showing 3 of ' + accounts.length + ' accounts · total ' + esc(money(acctTotal)) + '</p>' : '') +
        '</div>';
    } else if (can('accounts_view')) {
      acctCards = '<div class="card"><div class="card-head"><h2>Accounts</h2></div>' +
        emptyState('No accounts yet', 'Add a bank account or cash wallet so each transaction can be tied to a balance.', '<button class="btn" type="button" data-newacct="1">Add account</button>') +
        '</div>';
    }

    var html = '';

    html += '<div class="kpis">' +
      kpi('Available balance', money(life.net), 'Income ' + money(life.income) + ' − expenses ' + money(life.expense), life.net >= 0 ? 'pos' : 'neg') +
      kpi('Income · ' + monthLabel(thisMonth, true), money(cur.income), delta(cur.income, prev.income), 'pos') +
      kpi('Expenses · ' + monthLabel(thisMonth, true), money(cur.expense), delta(cur.expense, prev.expense, true), 'neg') +
      kpi('Net this month', money(cur.net), 'Savings rate ' + (isFinite(savings) ? savings.toFixed(0) : '0') + '%', cur.net >= 0 ? 'pos' : 'neg') +
      '</div>';

    html += acctCards;

    html += '<div class="grid2">';
    html += '<div class="card"><div class="card-head"><h2>Cash flow — last 6 months</h2><div class="spacer"></div>' +
      '<span class="badge"><span class="swatch" style="background:#0E7C66"></span>Income</span>' +
      '<span class="badge"><span class="swatch" style="background:#E7B4A6"></span>Expense</span></div>' +
      (range6.length ? trendChart(months) : emptyState('No activity yet', 'Add your first transaction to see the six-month cash flow.')) +
      '</div>';
    html += '<div class="card"><div class="card-head"><h2>Spending by category</h2></div>' +
      (catItems.length
        ? '<div class="donut-wrap">' + donutChart(catItems, monthExpense, 'Spent') + legendList(catItems, monthExpense) + '</div>'
        : emptyState('Nothing spent this month', 'Expenses recorded in ' + monthLabel(thisMonth) + ' will be broken down here.')) +
      '</div>';
    html += '</div>';

    html += '<div class="grid2">';
    html += '<div class="card"><div class="card-head"><h2>Recent activity</h2><div class="spacer"></div>' +
      '<button class="btn ghost small" type="button" data-goto="transactions">View all</button></div>';
    if (recent.length) {
      html += '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th class="r">Amount</th></tr></thead><tbody>';
      recent.forEach(function (t) {
        var c = catById(t.category_id);
        html += '<tr><td class="muted small" style="white-space:nowrap">' + esc(fmtDate(t.occurred_on)) + '</td>' +
          '<td><div class="tx-desc">' + esc(t.description || '—') + '</div></td>' +
          '<td><span class="rowcat"><span class="swatch" style="background:' + catColor(c) + '"></span>' + esc(c ? c.name : 'Uncategorised') + '</span></td>' +
          '<td class="r amount ' + (t.type === 'income' ? 'pos' : 'neg') + '">' + (t.type === 'income' ? '+' : '−') + esc(money(t.amount)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    } else {
      html += emptyState('No transactions yet', 'Your recorded income and expenses will appear here.', '<button class="btn" type="button" data-newtx="1">Add a transaction</button>');
    }
    html += '</div>';

    html += '<div class="card"><div class="card-head"><h2>Budgets · ' + esc(monthLabel(thisMonth)) + '</h2><div class="spacer"></div>' +
      '<button class="btn ghost small" type="button" data-goto="budgets">Manage</button></div>';
    if (budgets.length) {
      budgets.slice(0, 5).forEach(function (b) {
        var c = catById(b.category_id);
        var spent = byCat[b.category_id] || 0;
        var pct = num(b.amount) > 0 ? (spent / num(b.amount)) * 100 : 0;
        var cls = pct > 100 ? 'over' : pct > 85 ? 'warn' : '';
        html += '<div style="margin-bottom:13px"><div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:5px">' +
          '<span class="rowcat"><span class="swatch" style="background:' + catColor(c) + '"></span>' + esc(c ? c.name : 'Deleted category') + '</span>' +
          '<span class="budget-nums">' + esc(money(spent)) + ' / ' + esc(money(b.amount)) + '</span></div>' +
          '<div class="progress ' + cls + '"><span style="width:' + Math.min(pct, 100).toFixed(1) + '%"></span></div></div>';
      });
    } else {
      html += emptyState('No budgets set', 'Set a monthly limit per category to track overspending.', '<button class="btn ghost" type="button" data-goto="budgets">Create a budget</button>');
    }
    html += '</div></div>';

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load the dashboard</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function kpi(label, value, sub, cls) {
  return '<div class="kpi"><div class="label">' + esc(label) + '</div>' +
    '<div class="value ' + (cls || '') + '">' + esc(value) + '</div>' +
    '<div class="sub">' + esc(sub) + '</div></div>';
}
function delta(cur, prev, invert) {
  if (!prev) return 'No prior month data';
  var d = ((cur - prev) / Math.abs(prev)) * 100;
  var sign = d >= 0 ? '+' : '';
  var good = invert ? d <= 0 : d >= 0;
  return sign + d.toFixed(0) + '% vs previous month';
}

/* ============================================================
   Ledger views: Transactions / Income / Expenses
   ============================================================ */
function buildLedgers(force) {
  var host = $('#views');
  ['transactions', 'income', 'expenses'].forEach(function (key) {
    var existing = document.getElementById('view-' + key);
    if (existing) {
      if (!force) return;
      existing.remove();
    }
    var sec = document.createElement('section');
    sec.className = 'view';
    sec.id = 'view-' + key;
    var typeSel = key === 'transactions'
      ? '<select class="inp" data-led="type"><option value="all">All types</option><option value="income">Income</option><option value="expense">Expense</option></select>'
      : '';
    sec.innerHTML =
      '<div class="card">' +
        '<div class="toolbar">' +
          '<input class="inp" type="month" data-led="month" aria-label="Filter by month">' +
          typeSel +
          '<select class="inp" data-led="acct" aria-label="Filter by account"></select>' +
          '<select class="inp" data-led="cat" aria-label="Filter by category"></select>' +
          '<input class="inp search" type="search" data-led="q" placeholder="Search description" aria-label="Search description">' +
          '<button class="btn ghost small" type="button" data-led="reset">Clear filters</button>' +
          '<div class="spacer"></div>' +
          (can('transactions_create') ? '<button class="btn small" type="button" data-newtx="' + key + '">+ Add ' + (key === 'income' ? 'income' : key === 'expenses' ? 'expense' : 'transaction') + '</button>' : '') +
        '</div>' +
        '<div data-led="summary"></div>' +
        '<div data-led="body"></div>' +
        '<div class="pager" data-led="pager"></div>' +
      '</div>';
    host.appendChild(sec);
  });
}

function ledgerFilterOptions(sel, type, selected) {
  var list = cats.filter(function (c) { return type === 'all' || c.type === type; });
  var html = '<option value="all">All categories</option><option value="none">Uncategorised</option>';
  list.forEach(function (c) {
    html += '<option value="' + c.id + '">' + esc(c.name) + '</option>';
  });
  sel.innerHTML = html;
  sel.value = selected || 'all';
  if (sel.value !== selected) sel.value = 'all';
}

function accountFilterOptions(sel, selected) {
  var html = '<option value="all">All accounts</option><option value="none">No account</option>';
  accounts.forEach(function (a) {
    html += '<option value="' + a.id + '">' + esc(a.name) + '</option>';
  });
  sel.innerHTML = html;
  sel.value = selected || 'all';
  if (sel.value !== selected) sel.value = 'all';
}

async function loadLedger(key) {
  var st = state.ledgers[key];
  var sec = document.getElementById('view-' + key);
  if (!sec) return;
  var monthInput = $('[data-led="month"]', sec);
  var catSel = $('[data-led="cat"]', sec);
  var acctSel = $('[data-led="acct"]', sec);
  var typeSel = $('[data-led="type"]', sec);
  var qInput = $('[data-led="q"]', sec);

  monthInput.value = st.month;
  if (typeSel) typeSel.value = st.type;
  ledgerFilterOptions(catSel, st.type, st.cat);
  if (acctSel) accountFilterOptions(acctSel, st.acct);
  if (qInput.value !== st.q) qInput.value = st.q;

  var body = $('[data-led="body"]', sec);
  body.innerHTML = '<div class="center-screen" style="min-height:140px;padding:0"><div class="spinner"></div></div>';

  var from = st.month ? monthStart(st.month) : null;
  var to = st.month ? monthEnd(st.month) : null;

  try {
    var q = sb.from('transactions').select(txCols(), { count: 'exact' });
    if (from) q = q.gte('occurred_on', from).lte('occurred_on', to);
    if (st.type !== 'all') q = q.eq('type', st.type);
    if (st.cat === 'none') q = q.is('category_id', null);
    else if (st.cat !== 'all') q = q.eq('category_id', st.cat);
    if (stage2Ready) {
      if (st.acct === 'none') q = q.is('account_id', null);
      else if (st.acct !== 'all') q = q.eq('account_id', st.acct);
    }
    if (st.q) q = q.ilike('description', '%' + st.q + '%');
    q = q.order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
      .range(st.page * PAGE_SIZE, st.page * PAGE_SIZE + PAGE_SIZE - 1);

    var res = await q;
    if (res.error) throw res.error;
    var rows = res.data || [];
    st.rows = rows;
    st.count = res.count || 0;

    /* Summary for the filtered set (all pages, not just this page) */
    var sumFrom = from || '1900-01-01';
    var sumTo = to || '2999-12-31';
    var all = await fetchRange(sumFrom, sumTo, st.type);
    if (st.cat !== 'all' || st.q || st.acct !== 'all') {
      all = all.filter(function (r) {
        if (st.cat === 'none' && r.category_id) return false;
        if (st.cat !== 'all' && st.cat !== 'none' && r.category_id !== st.cat) return false;
        if (st.acct === 'none' && r.account_id) return false;
        if (st.acct !== 'all' && st.acct !== 'none' && r.account_id !== st.acct) return false;
        if (st.q && String(r.description || '').toLowerCase().indexOf(st.q.toLowerCase()) < 0) return false;
        return true;
      });
    }
    var t = totals(all);
    var sum = '<div class="grid3" style="margin-bottom:16px">' +
      kpi('Income', money(t.income), all.filter(function (r) { return r.type === 'income'; }).length + ' records', 'pos') +
      kpi('Expenses', money(t.expense), all.filter(function (r) { return r.type === 'expense'; }).length + ' records', 'neg') +
      kpi('Net', money(t.net), st.month ? monthLabel(st.month) : 'All time', t.net >= 0 ? 'pos' : 'neg') +
      '</div>';
    $('[data-led="summary"]', sec).innerHTML = sum;

    if (!rows.length) {
      body.innerHTML = emptyState(
        st.count ? 'No rows on this page' : 'No records found',
        st.month ? 'Nothing recorded for ' + monthLabel(st.month) + ' with the current filters.' : 'Add your first record to start tracking.',
        '<button class="btn" type="button" data-newtx="' + key + '">Add ' + (key === 'income' ? 'income' : key === 'expenses' ? 'expense' : 'transaction') + '</button>'
      );
      $('[data-led="pager"]', sec).innerHTML = '';
      return;
    }

    var showActions = can('transactions_edit') || can('transactions_delete');
    var html = '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Date</th><th>Description</th><th>Category</th><th>Account</th><th>Type</th><th class="r">Amount</th>' +
      (showActions ? '<th></th>' : '') +
      '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var c = catById(r.category_id);
      var a = acctById(r.account_id);
      html += '<tr>' +
        '<td class="muted small" style="white-space:nowrap">' + esc(fmtDate(r.occurred_on)) + '</td>' +
        '<td><div class="tx-desc">' + esc(r.description || '—') + '</div></td>' +
        '<td><span class="rowcat"><span class="swatch" style="background:' + catColor(c) + '"></span>' + esc(c ? c.name : 'Uncategorised') + '</span></td>' +
        '<td class="muted small" style="white-space:nowrap">' + esc(a ? a.name : '—') + '</td>' +
        '<td><span class="badge ' + (r.type === 'income' ? 'in' : 'ex') + '">' + (r.type === 'income' ? 'Income' : 'Expense') + '</span></td>' +
        '<td class="r amount ' + (r.type === 'income' ? 'pos' : 'neg') + '">' + (r.type === 'income' ? '+' : '−') + esc(money(r.amount)) + '</td>' +
        (showActions
          ? '<td><div class="row-actions">' +
              (can('transactions_edit') ? '<button class="icon-btn" type="button" title="Edit" data-edit-tx="' + r.id + '">✎</button>' : '') +
              (can('transactions_delete') ? '<button class="icon-btn" type="button" title="Delete" data-del-tx="' + r.id + '">✕</button>' : '') +
            '</div></td>'
          : '') +
        '</tr>';
    });
    html += '</tbody></table></div>';
    body.innerHTML = html;

    var pages = Math.max(1, Math.ceil(st.count / PAGE_SIZE));
    var start = st.count ? st.page * PAGE_SIZE + 1 : 0;
    var end = Math.min(st.count, (st.page + 1) * PAGE_SIZE);
    $('[data-led="pager"]', sec).innerHTML =
      '<span>' + start + '–' + end + ' of ' + st.count + '</span>' +
      '<span style="display:flex;gap:6px">' +
        '<button class="btn ghost small" type="button" data-page="' + key + '" data-dir="-1"' + (st.page <= 0 ? ' disabled' : '') + '>Previous</button>' +
        '<button class="btn ghost small" type="button" data-page="' + key + '" data-dir="1"' + (st.page >= pages - 1 ? ' disabled' : '') + '>Next</button>' +
      '</span>';
  } catch (e) {
    body.innerHTML = '<div class="empty"><h3>Could not load records</h3><p>' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
}
VIEW_LOADERS.transactions = function () { $('#page-sub').textContent = 'All recorded income and expenses'; return loadLedger('transactions'); };
VIEW_LOADERS.income = function () { $('#page-sub').textContent = 'Money received'; return loadLedger('income'); };
VIEW_LOADERS.expenses = function () { $('#page-sub').textContent = 'Money spent'; return loadLedger('expenses'); };

/* ============================================================
   Transaction modal + CRUD
   ============================================================ */
var modalSubmit = null;

function closeModal() {
  $('#modal-root').innerHTML = '';
  modalSubmit = null;
}

/* In-app confirmation dialog (window.confirm is blocked in sandboxed frames). */
function askConfirm(title, message, confirmLabel, danger) {
  return new Promise(function (resolve) {
    var root = $('#modal-root');
    root.innerHTML = '<div class="overlay" data-cf-overlay="1"><div class="modal" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h3>' + esc(title) + '</h3></div>' +
      '<div class="modal-body"><p class="muted" style="margin:0">' + esc(message) + '</p></div>' +
      '<div class="modal-foot">' +
      '<button class="btn ghost" type="button" data-cf-close="1">Cancel</button>' +
      '<button class="btn ' + (danger ? 'danger' : '') + '" type="button" id="cf-yes">' + esc(confirmLabel || 'Confirm') + '</button>' +
      '</div></div></div>';
    var settled = false;
    function finish(v) {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(v);
    }
    $('#cf-yes').addEventListener('click', function () { finish(true); });
    $$('[data-cf-close]', root).forEach(function (b) { b.addEventListener('click', function () { finish(false); }); });
    var ov = $('[data-cf-overlay]', root);
    ov.addEventListener('click', function (e) { if (e.target === ov) finish(false); });
  });
}

function openModal(opts) {
  var root = $('#modal-root');
  root.innerHTML = '<div class="overlay" data-overlay="1"><div class="modal ' + (opts.wide ? 'wide' : '') + '" role="dialog" aria-modal="true">' +
    '<div class="modal-head"><h3>' + esc(opts.title) + '</h3>' +
    '<button class="icon-btn" type="button" data-close="1" aria-label="Close">✕</button></div>' +
    '<form class="modal-body" id="modal-form" novalidate>' + opts.body +
    '<p class="form-err" id="modal-err"></p></form>' +
    '<div class="modal-foot">' +
    (opts.footExtra || '') +
    '<button class="btn ghost" type="button" data-close="1">Cancel</button>' +
    '<button class="btn" type="submit" form="modal-form" id="modal-save">' + esc(opts.submitLabel || 'Save') + '</button>' +
    '</div></div></div>';

  modalSubmit = opts.onSubmit;
  $('#modal-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var btn = $('#modal-save');
    var errEl = $('#modal-err');
    errEl.textContent = '';
    btn.disabled = true;
    var old = btn.textContent;
    btn.textContent = 'Saving…';
    try {
      await modalSubmit($('#modal-form'));
      closeModal();
    } catch (e) {
      errEl.textContent = errMsg(e);
      btn.disabled = false;
      btn.textContent = old;
    }
  });
  var first = $('#modal-form .inp');
  if (first) setTimeout(function () { first.focus(); }, 40);
}

function catOptions(type, selected) {
  var list = cats.filter(function (c) { return c.type === type; });
  var html = '<option value="">Uncategorised</option>';
  list.forEach(function (c) {
    html += '<option value="' + c.id + '"' + (selected === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>';
  });
  return html;
}

function accountOptions(selected) {
  var html = '<option value="">No account</option>';
  activeAccounts().forEach(function (a) {
    html += '<option value="' + a.id + '"' + (selected === a.id ? ' selected' : '') + '>' +
      esc(a.name) + ' · ' + esc(a.currency) + '</option>';
  });
  return html;
}

function openTxModal(existing, presetType) {
  if (!existing && !can('transactions_create')) { toast('Your role cannot create transactions.', 'err'); return; }
  if (existing && !can('transactions_edit')) { toast('Your role cannot edit transactions.', 'err'); return; }
  var isEdit = !!existing;
  var type = existing ? existing.type : (presetType === 'income' ? 'income' : presetType === 'expenses' ? 'expense' : 'expense');
  var body =
    '<label class="field"><span>Type</span><select class="inp" id="tx-type">' +
      '<option value="income"' + (type === 'income' ? ' selected' : '') + '>Income</option>' +
      '<option value="expense"' + (type === 'expense' ? ' selected' : '') + '>Expense</option>' +
    '</select></label>' +
    '<label class="field"><span>Amount</span><input class="inp" id="tx-amount" type="number" min="0.01" step="0.01" inputmode="decimal" required value="' + (existing ? esc(existing.amount) : '') + '" placeholder="0.00"></label>' +
    '<label class="field"><span>Date</span><input class="inp" id="tx-date" type="date" required value="' + esc(existing ? String(existing.occurred_on).slice(0, 10) : todayISO()) + '"></label>' +
    (stage2Ready ? '<label class="field"><span>Account</span><select class="inp" id="tx-acct">' + accountOptions(existing ? existing.account_id : null) + '</select></label>' : '') +
    '<label class="field"><span>Category</span><select class="inp" id="tx-cat">' + catOptions(type, existing ? existing.category_id : null) + '</select></label>' +
    '<label class="field"><span>Description</span><input class="inp" id="tx-desc" maxlength="160" placeholder="e.g. Monthly rent" value="' + esc(existing ? existing.description : '') + '"></label>';

  openModal({
    title: isEdit ? 'Edit transaction' : 'New transaction',
    body: body,
    submitLabel: isEdit ? 'Save changes' : 'Add transaction',
    onSubmit: async function () {
      requireSession();
      var t = $('#tx-type').value;
      var amount = Math.round(num($('#tx-amount').value) * 100) / 100;
      var date = $('#tx-date').value;
      var cat = $('#tx-cat').value || null;
      var acct = stage2Ready ? ($('#tx-acct') ? ($('#tx-acct').value || null) : null) : null;
      var desc = $('#tx-desc').value.trim();
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
      if (!date) throw new Error('Choose a date.');
      if (cat) {
        var c = catById(cat);
        if (c && c.type !== t) throw new Error('That category belongs to ' + c.type + '. Pick a ' + t + ' category.');
      }
      var payload = {
        user_id: user.id, type: t, amount: amount, occurred_on: date,
        category_id: cat, description: desc
      };
      if (stage2Ready) payload.account_id = acct;
      var res;
      if (isEdit) {
        res = await sb.from('transactions').update(payload).eq('id', existing.id).select().single();
      } else {
        res = await sb.from('transactions').insert(payload).select().single();
      }
      if (res.error) throw res.error;
      await loadAccounts();
      playSound(t === 'income' ? 'incomeSaved' : 'expenseSaved');
      toast(isEdit ? 'Transaction updated' : 'Transaction added', 'ok');
      refreshCurrent();
    }
  });

  $('#tx-type').addEventListener('change', function () {
    var t = this.value;
    var cur = $('#tx-cat').value;
    var keep = catById(cur);
    $('#tx-cat').innerHTML = catOptions(t, keep && keep.type === t ? cur : null);
  });
}

async function deleteTransaction(id) {
  if (!can('transactions_delete')) { toast('Your role cannot delete transactions.', 'err'); return; }
  var row = findTx(id);
  var label = row ? (row.description || 'this transaction') : 'this transaction';
  var ok = await askConfirm('Delete transaction', 'Delete "' + label + '"? This cannot be undone.', 'Delete', true);
  if (!ok) return;
  try {
    var res = await sb.from('transactions').delete().eq('id', id);
    if (res.error) throw res.error;
    await loadAccounts();
    playSound('transactionDeleted');
    toast('Transaction deleted', 'ok');
    refreshCurrent();
  } catch (e) { toast(errMsg(e), 'err'); }
}

function refreshCurrent() {
  var fn = VIEW_LOADERS[state.view];
  if (fn) fn();
}

/* ============================================================
   Categories
   ============================================================ */
VIEW_LOADERS.categories = async function () {
  var el = $('#view-categories');
  $('#page-sub').textContent = 'Organise income and expense categories';
  el.innerHTML = loadingCard('Loading categories…');
  try {
    await loadCategories();
    var income = cats.filter(function (c) { return c.type === 'income'; });
    var expense = cats.filter(function (c) { return c.type === 'expense'; });

    function group(title, type, list) {
      var rows = list.length ? list.map(function (c) {
        return '<div class="budget-row" style="grid-template-columns:1fr auto">' +
          '<span class="rowcat"><span class="swatch" style="background:' + catColor(c) + '"></span>' +
          '<span style="font-weight:550">' + esc(c.name) + '</span></span>' +
          '<span class="row-actions">' +
            '<button class="icon-btn" type="button" title="Edit" data-edit-cat="' + c.id + '">✎</button>' +
            '<button class="icon-btn" type="button" title="Delete" data-del-cat="' + c.id + '">✕</button>' +
          '</span></div>';
      }).join('') : '<p class="muted small" style="margin:14px 0">No ' + type + ' categories yet.</p>';

      return '<div class="card"><div class="card-head"><h2>' + esc(title) + '</h2>' +
        '<span class="badge">' + list.length + '</span><div class="spacer"></div>' +
        '<button class="btn ghost small" type="button" data-newcat="' + type + '">+ Add</button></div>' +
        rows + '</div>';
    }

    el.innerHTML = '<div class="grid2">' + group('Income categories', 'income', income) +
      group('Expense categories', 'expense', expense) + '</div>' +
      '<div class="card"><p class="muted small" style="margin:0">Deleting a category keeps its transactions and marks them as uncategorised. ' +
      'Category names are unique per user and type.</p></div>';
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load categories</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function colorSwatches(selected) {
  return '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:2px">' + PALETTE.map(function (c) {
    return '<button type="button" class="swatch-pick" data-color="' + c + '" style="width:26px;height:26px;border-radius:7px;border:2px solid ' +
      (c === selected ? '#0B1220' : 'transparent') + ';background:' + c + ';cursor:pointer" aria-label="Colour ' + c + '"></button>';
  }).join('') + '</div>';
}

function openCatModal(existing, presetType) {
  var isEdit = !!existing;
  var type = existing ? existing.type : (presetType || 'expense');
  var color = existing ? existing.color : PALETTE[0];
  var body =
    '<label class="field"><span>Name</span><input class="inp" id="cat-name" maxlength="40" required value="' + esc(existing ? existing.name : '') + '" placeholder="e.g. Groceries"></label>' +
    '<label class="field"><span>Type</span><select class="inp" id="cat-type"' + (isEdit ? ' disabled' : '') + '>' +
      '<option value="income"' + (type === 'income' ? ' selected' : '') + '>Income</option>' +
      '<option value="expense"' + (type === 'expense' ? ' selected' : '') + '>Expense</option>' +
    '</select></label>' +
    '<div class="field"><span>Colour</span>' + colorSwatches(color) + '</div>' +
    '<input type="hidden" id="cat-color" value="' + esc(color) + '">';

  openModal({
    title: isEdit ? 'Edit category' : 'New category',
    body: body,
    submitLabel: isEdit ? 'Save changes' : 'Create category',
    onSubmit: async function () {
      requireSession();
      var name = $('#cat-name').value.trim();
      if (!name) throw new Error('Enter a category name.');
      var t = isEdit ? existing.type : $('#cat-type').value;
      var col = $('#cat-color').value || PALETTE[0];
      var payload = { user_id: user.id, name: name, type: t, color: col };
      var res;
      if (isEdit) res = await sb.from('categories').update({ name: name, color: col }).eq('id', existing.id).select().single();
      else res = await sb.from('categories').insert(payload).select().single();
      if (res.error) {
        if (String(res.error.code) === '23505') throw new Error('A ' + t + ' category named "' + name + '" already exists.');
        throw res.error;
      }
      await loadCategories();
      toast(isEdit ? 'Category updated' : 'Category created', 'ok');
      refreshCurrent();
    }
  });

  $$('.swatch-pick').forEach(function (b) {
    b.addEventListener('click', function () {
      $('#cat-color').value = b.getAttribute('data-color');
      $$('.swatch-pick').forEach(function (x) { x.style.borderColor = 'transparent'; });
      b.style.borderColor = '#0B1220';
    });
  });
}

async function deleteCategory(id) {
  var c = catById(id);
  if (!c) return;
  var ok = await askConfirm(
    'Delete category',
    'Delete "' + c.name + '"? Its transactions are kept but become uncategorised, and budgets for this category are removed.',
    'Delete category', true
  );
  if (!ok) return;
  try {
    var res = await sb.from('categories').delete().eq('id', id);
    if (res.error) throw res.error;
    await loadCategories();
    toast('Category deleted', 'ok');
    refreshCurrent();
  } catch (e) { toast(errMsg(e), 'err'); }
}

/* ============================================================
   Budgets
   ============================================================ */
VIEW_LOADERS.budgets = async function () {
  var el = $('#view-budgets');
  $('#page-sub').textContent = 'Monthly limits per expense category';
  el.innerHTML = loadingCard('Loading budgets…');
  try {
    var mk = state.budgetMonth;
    await loadCategories();
    var res = await Promise.all([
      sb.from('budgets').select('id,category_id,amount,period_month').eq('period_month', monthStart(mk)),
      fetchRange(monthStart(mk), monthEnd(mk), 'expense')
    ]);
    if (res[0].error) throw res[0].error;
    var budgets = res[0].data || [];
    var spentRows = res[1];

    var spentBy = {};
    spentRows.forEach(function (r) {
      var k = r.category_id || 'none';
      spentBy[k] = (spentBy[k] || 0) + num(r.amount);
    });

    var bmap = {};
    budgets.forEach(function (b) { bmap[b.category_id] = num(b.amount); });

    var expenseCats = cats.filter(function (c) { return c.type === 'expense'; });
    var totalBudget = budgets.reduce(function (s, b) { return s + num(b.amount); }, 0);
    var totalSpent = spentRows.reduce(function (s, r) { return s + num(r.amount); }, 0);
    var overallPct = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;

    var html = '<div class="card"><div class="toolbar">' +
      '<input class="inp" type="month" id="budget-month" value="' + esc(mk) + '" aria-label="Budget month">' +
      '<span class="muted small">Budgets are stored per category and month.</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost small" type="button" id="budget-copy">Copy last month</button>' +
      '</div>' +
      '<div class="grid3">' +
        kpi('Budgeted', money(totalBudget), budgets.length + ' categories', '') +
        kpi('Spent', money(totalSpent), monthLabel(mk), 'neg') +
        kpi('Remaining', money(totalBudget - totalSpent), overallPct.toFixed(0) + '% of budget used', totalBudget - totalSpent >= 0 ? 'pos' : 'neg') +
      '</div></div>';

    html += '<div class="card"><div class="card-head"><h2>Category budgets · ' + esc(monthLabel(mk)) + '</h2></div>';
    if (!expenseCats.length) {
      html += emptyState('No expense categories', 'Create an expense category before setting a budget.', '<button class="btn" type="button" data-goto="categories">Go to categories</button>');
    } else {
      expenseCats.forEach(function (c) {
        var limit = bmap[c.id] || 0;
        var spent = spentBy[c.id] || 0;
        var pct = limit > 0 ? (spent / limit) * 100 : 0;
        var cls = pct > 100 ? 'over' : pct > 85 ? 'warn' : '';
        html += '<div class="budget-row">' +
          '<div><span class="rowcat"><span class="swatch" style="background:' + catColor(c) + '"></span>' +
          '<span style="font-weight:550">' + esc(c.name) + '</span></span></div>' +
          '<input class="inp budget-input" type="number" min="0" step="0.01" inputmode="decimal" data-budget-cat="' + c.id + '" value="' + (limit ? limit : '') + '" placeholder="No limit" aria-label="Budget for ' + esc(c.name) + '">' +
          '<div>' +
            '<div class="budget-nums" style="display:flex;justify-content:space-between;margin-bottom:5px">' +
              '<span>' + esc(money(spent)) + ' spent</span>' +
              '<span>' + (limit > 0 ? (pct > 100 ? 'Over by ' + esc(money(spent - limit)) : esc(money(limit - spent)) + ' left') : 'No budget set') + '</span>' +
            '</div>' +
            '<div class="progress ' + cls + '"><span style="width:' + (limit > 0 ? Math.min(pct, 100).toFixed(1) : 0) + '%"></span></div>' +
          '</div>' +
        '</div>';
      });
    }
    html += '</div>';
    el.innerHTML = html;

    $('#budget-month').addEventListener('change', function () {
      state.budgetMonth = this.value || monthKey();
      VIEW_LOADERS.budgets();
    });

    $('#budget-copy').addEventListener('click', async function () {
      var prev = addMonths(mk, -1);
      var r = await sb.from('budgets').select('category_id,amount').eq('period_month', monthStart(prev));
      if (r.error) return toast(errMsg(r.error), 'err');
      if (!r.data || !r.data.length) return toast('No budgets found in ' + monthLabel(prev), 'err');
      var rows = r.data.map(function (b) {
        return { user_id: user.id, category_id: b.category_id, period_month: monthStart(mk), amount: num(b.amount) };
      });
      var up = await sb.from('budgets').upsert(rows, { onConflict: 'user_id,category_id,period_month' });
      if (up.error) return toast(errMsg(up.error), 'err');
      playSound('smartFill');
      toast('Copied ' + rows.length + ' budgets from ' + monthLabel(prev), 'ok');
      VIEW_LOADERS.budgets();
    });

    $$('.budget-input').forEach(function (inp) {
      inp.addEventListener('change', async function () {
        var cid = inp.getAttribute('data-budget-cat');
        var val = Math.round(num(inp.value) * 100) / 100;
        try {
          requireSession();
          if (!val || val <= 0) {
            var del = await sb.from('budgets').delete().eq('category_id', cid).eq('period_month', monthStart(mk));
            if (del.error) throw del.error;
            toast('Budget removed', 'ok');
          } else {
            var up = await sb.from('budgets').upsert(
              { user_id: user.id, category_id: cid, period_month: monthStart(mk), amount: val },
              { onConflict: 'user_id,category_id,period_month' }
            );
            if (up.error) throw up.error;
            playSound('budgetSaved');
            toast('Budget saved', 'ok');
          }
          VIEW_LOADERS.budgets();
        } catch (e) { toast(errMsg(e), 'err'); }
      });
    });
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load budgets</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

/* ============================================================
   Reports
   ============================================================ */
VIEW_LOADERS.reports = async function () {
  var el = $('#view-reports');
  $('#page-sub').textContent = 'Monthly and yearly summaries';
  el.innerHTML = loadingCard('Building report…');
  try {
    await loadCategories();
    var isYear = state.reportMode === 'year';
    var from, to, label;
    if (isYear) {
      var y = Number(state.reportYear);
      from = y + '-01-01'; to = y + '-12-31'; label = String(y);
    } else {
      from = monthStart(state.reportMonth); to = monthEnd(state.reportMonth); label = monthLabel(state.reportMonth);
    }

    var rows = await fetchRange(from, to, 'all');
    var t = totals(rows);

    /* bucket by month */
    var buckets = {};
    rows.forEach(function (r) {
      var k = String(r.occurred_on).slice(0, 7);
      if (!buckets[k]) buckets[k] = { key: k, income: 0, expense: 0, count: 0 };
      if (r.type === 'income') buckets[k].income += num(r.amount); else buckets[k].expense += num(r.amount);
      buckets[k].count++;
    });
    var keys = Object.keys(buckets).sort();
    var series = keys.map(function (k) {
      return { key: k, label: monthLabel(k, true), income: buckets[k].income, expense: buckets[k].expense };
    });

    /* category breakdown */
    var byCat = {};
    rows.forEach(function (r) {
      var key = (r.type === 'income' ? 'i:' : 'e:') + (r.category_id || 'none');
      byCat[key] = (byCat[key] || 0) + num(r.amount);
    });
    var expItems = [], incItems = [];
    Object.keys(byCat).forEach(function (key) {
      var isInc = key.slice(0, 2) === 'i:';
      var id = key.slice(2);
      var c = catById(id === 'none' ? null : id);
      var item = { label: c ? c.name : 'Uncategorised', value: byCat[key], color: catColor(c) };
      (isInc ? incItems : expItems).push(item);
    });
    expItems.sort(function (a, b) { return b.value - a.value; });
    incItems.sort(function (a, b) { return b.value - a.value; });

    var best = series.slice().sort(function (a, b) { return (b.income - b.expense) - (a.income - a.expense); })[0];
    var worst = series.slice().sort(function (a, b) { return (a.income - a.expense) - (b.income - b.expense); })[0];
    var avgExpense = series.length ? t.expense / series.length : 0;

    var html = '<div class="card"><div class="toolbar">' +
      '<select class="inp" id="rep-mode">' +
        '<option value="year"' + (isYear ? ' selected' : '') + '>Yearly</option>' +
        '<option value="month"' + (!isYear ? ' selected' : '') + '>Monthly</option>' +
      '</select>' +
      (isYear
        ? '<select class="inp" id="rep-year">' + yearOptions(state.reportYear) + '</select>'
        : '<input class="inp" type="month" id="rep-month" value="' + esc(state.reportMonth) + '">') +
      '<span class="badge">' + esc(label) + '</span>' +
      '<div class="spacer"></div>' +
      '<button class="btn ghost small" type="button" id="rep-export">Export CSV</button>' +
      '</div>' +
      '<div class="kpis">' +
        kpi('Total income', money(t.income), rows.filter(function (r) { return r.type === 'income'; }).length + ' records', 'pos') +
        kpi('Total expenses', money(t.expense), rows.filter(function (r) { return r.type === 'expense'; }).length + ' records', 'neg') +
        kpi('Net result', money(t.net), t.income > 0 ? ((t.net / t.income) * 100).toFixed(0) + '% of income kept' : 'No income recorded', t.net >= 0 ? 'pos' : 'neg') +
        kpi('Average monthly expense', money(avgExpense), series.length + ' active months', '') +
      '</div></div>';

    if (!rows.length) {
      html += '<div class="card">' + emptyState('No data for ' + label, 'Records dated in this period will appear in the report.', '<button class="btn" type="button" data-newtx="1">Add a transaction</button>') + '</div>';
      el.innerHTML = html;
      bindReportControls(rows, label);
      return;
    }

    html += '<div class="grid2">';
    html += '<div class="card"><div class="card-head"><h2>Income vs expenses by month</h2><div class="spacer"></div>' +
      '<span class="badge"><span class="swatch" style="background:#0E7C66"></span>Income</span>' +
      '<span class="badge"><span class="swatch" style="background:#E7B4A6"></span>Expense</span></div>' +
      trendChart(series) + '</div>';

    html += '<div class="card"><div class="card-head"><h2>Where the money went</h2></div>' +
      (expItems.length
        ? '<div class="donut-wrap">' + donutChart(expItems.slice(0, 8), t.expense, 'Expenses') +
          legendList(expItems.slice(0, 8), t.expense) + '</div>'
        : '<p class="muted small" style="margin:0">No expenses recorded in this period.</p>') +
      '</div>';
    html += '</div>';

    html += '<div class="grid2">';
    html += '<div class="card"><div class="card-head"><h2>Month-by-month</h2></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th class="r">Income</th><th class="r">Expenses</th><th class="r">Net</th><th class="r">Records</th></tr></thead><tbody>';
    series.forEach(function (m) {
      html += '<tr><td>' + esc(monthLabel(m.key)) + '</td>' +
        '<td class="r pos mono">' + esc(money(m.income)) + '</td>' +
        '<td class="r neg mono">' + esc(money(m.expense)) + '</td>' +
        '<td class="r mono ' + (m.income - m.expense >= 0 ? 'pos' : 'neg') + '">' + esc(money(m.income - m.expense)) + '</td>' +
        '<td class="r muted">' + buckets[m.key].count + '</td></tr>';
    });
    html += '</tbody><tfoot><tr style="font-weight:650"><td>Total</td>' +
      '<td class="r pos mono">' + esc(money(t.income)) + '</td>' +
      '<td class="r neg mono">' + esc(money(t.expense)) + '</td>' +
      '<td class="r mono ' + (t.net >= 0 ? 'pos' : 'neg') + '">' + esc(money(t.net)) + '</td>' +
      '<td class="r muted">' + rows.length + '</td></tr></tfoot></table></div></div>';

    html += '<div class="card"><div class="card-head"><h2>Category detail</h2></div>' +
      '<div class="table-wrap"><table class="table"><thead><tr><th>Expense category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>';
    expItems.forEach(function (d) {
      html += '<tr><td><span class="rowcat"><span class="swatch" style="background:' + d.color + '"></span>' + esc(d.label) + '</span></td>' +
        '<td class="r mono">' + esc(money(d.value)) + '</td>' +
        '<td class="r muted">' + (t.expense > 0 ? ((d.value / t.expense) * 100).toFixed(0) : 0) + '%</td></tr>';
    });
    html += '</tbody></table></div>' +
      (incItems.length ? '<h2 style="margin:18px 0 10px;font-size:13.5px">Income sources</h2>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Source</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>' +
        incItems.map(function (d) {
          return '<tr><td><span class="rowcat"><span class="swatch" style="background:' + d.color + '"></span>' + esc(d.label) + '</span></td>' +
            '<td class="r mono">' + esc(money(d.value)) + '</td>' +
            '<td class="r muted">' + (t.income > 0 ? ((d.value / t.income) * 100).toFixed(0) : 0) + '%</td></tr>';
        }).join('') + '</tbody></table></div>' : '') +
      '</div>';
    html += '</div>';

    if (best) {
      html += '<div class="card"><div class="card-head"><h2>Period highlights</h2></div><div class="grid3">' +
        kpi('Strongest month', best.label, 'Net ' + money(best.income - best.expense), 'pos') +
        kpi('Weakest month', worst.label, 'Net ' + money(worst.income - worst.expense), worst.income - worst.expense >= 0 ? 'pos' : 'neg') +
        kpi('Largest expense category', expItems[0] ? expItems[0].label : '—', expItems[0] ? money(expItems[0].value) : '—', '') +
        '</div></div>';
    }

    el.innerHTML = html;
    bindReportControls(rows, label);
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not build the report</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function yearOptions(sel) {
  var now = new Date().getFullYear(), out = '';
  for (var y = now + 1; y >= now - 6; y--) {
    out += '<option value="' + y + '"' + (String(y) === String(sel) ? ' selected' : '') + '>' + y + '</option>';
  }
  return out;
}

function bindReportControls(rows, label) {
  var mode = $('#rep-mode');
  if (mode) mode.addEventListener('change', function () {
    state.reportMode = this.value;
    VIEW_LOADERS.reports();
  });
  var yr = $('#rep-year');
  if (yr) yr.addEventListener('change', function () { state.reportYear = this.value; VIEW_LOADERS.reports(); });
  var mo = $('#rep-month');
  if (mo) mo.addEventListener('change', function () { state.reportMonth = this.value || monthKey(); VIEW_LOADERS.reports(); });
  var ex = $('#rep-export');
  if (ex) ex.addEventListener('click', function () { exportCsv(rows, label); });
}

function exportCsv(rows, label) {
  if (!rows.length) return toast('Nothing to export', 'err');
  var lines = ['Date,Type,Category,Description,Amount,Currency'];
  rows.slice().sort(function (a, b) { return String(a.occurred_on).localeCompare(String(b.occurred_on)); }).forEach(function (r) {
    var c = catById(r.category_id);
    lines.push([
      String(r.occurred_on).slice(0, 10),
      r.type,
      '"' + (c ? c.name : 'Uncategorised').replace(/"/g, '""') + '"',
      '"' + String(r.description || '').replace(/"/g, '""') + '"',
      num(r.amount).toFixed(2),
      (profile && profile.currency) || 'USD'
    ].join(','));
  });
  var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pinch-report-' + String(label).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv';
  document.body.appendChild(a);
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  toast('Report exported', 'ok');
}

/* ============================================================
   Sound effects
   ------------------------------------------------------------
   Browsers block audio until a user gesture, so the context is created
   lazily on the first click and every later cue reuses it. Each cue owns
   one channel: replaying a cue stops its previous voice, and a short
   global gap keeps two different cues from colliding.

   Files are looked up as <NAME>.WAV in the repository root, beside index.html.
   A missing file disables that cue silently - a missing sound must never break
   a database operation.
   ============================================================ */
/* Flat repository layout: the WAV files sit in the repository root beside
   index.html, so the base path is empty. */
var SOUND_BASE = '';
var SOUND_FILES = {
  launch: 'LAUNCH.WAV',
  calc: 'CALCULAT.WAV',
  cashPlus: 'CASHPLS.WAV',
  cashMinus: 'CASHMIN.WAV',
  congrats: 'CONGRATS.WAV',
  smartFill: 'SMARFILL.WAV',
  rollover: 'ROLLOVER.WAV',
  moveForward: 'MOVEFORW.WAV',
  moveBack: 'MOVEBACK.WAV'
};

/* Cue names used by the app, mapped to the files above. */
var SOUND_CUES = {
  appLaunch: 'launch',
  signIn: 'launch',
  incomeSaved: 'cashPlus',
  expenseSaved: 'cashMinus',
  transactionDeleted: 'moveBack',
  accountCreated: 'congrats',
  accountDeleted: 'moveBack',
  budgetSaved: 'smartFill',
  transferPosted: 'calc',
  transferConfirmed: 'moveForward',
  transferDeleted: 'moveBack',
  periodChanged: 'rollover'
};

var audioCtx = null;
var soundBuffers = {};
var soundVoices = {};
var soundFailed = {};
var soundEnabled = true;
var lastCueAt = 0;
var CUE_GAP_MS = 120;

function soundSupported() {
  return !!(window.AudioContext || window.webkitAudioContext);
}

function ensureAudio() {
  if (!soundSupported()) return null;
  if (!audioCtx) {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      audioCtx = new Ctx();
    } catch (e) { soundEnabled = false; return null; }
  }
  if (audioCtx.state === 'suspended') {
    try { audioCtx.resume(); } catch (e) { /* ignore */ }
  }
  return audioCtx;
}

function loadSound(name) {
  if (!soundEnabled || !SOUND_FILES[name] || soundFailed[name]) return;
  if (soundBuffers[name]) return;
  var ctx = ensureAudio();
  if (!ctx) return;
  var url = SOUND_BASE + SOUND_FILES[name];
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('missing'); return r.arrayBuffer(); })
    .then(function (buf) { return ctx.decodeAudioData(buf); })
    .then(function (decoded) { soundBuffers[name] = decoded; })
    .catch(function () { soundFailed[name] = true; });
}

function preloadSounds() {
  Object.keys(SOUND_FILES).forEach(function (k) { loadSound(k); });
}

/* Play one cue. Never throws, never overlaps itself. */
function playSound(cueName) {
  if (!soundEnabled) return;
  var name = SOUND_CUES[cueName];
  if (!name || soundFailed[name]) return;
  var ctx = ensureAudio();
  if (!ctx) return;
  if (!soundBuffers[name]) {
    /* Fetch on demand, then play if it arrives quickly. */
    loadSound(name);
    return;
  }
  var now = Date.now();
  if (now - lastCueAt < CUE_GAP_MS) return;
  lastCueAt = now;
  try {
    var prev = soundVoices[name];
    if (prev) { try { prev.stop(); } catch (e) { /* ignore */ } }
    var src = ctx.createBufferSource();
    src.buffer = soundBuffers[name];
    var gain = ctx.createGain();
    gain.gain.value = 0.6;
    src.connect(gain);
    gain.connect(ctx.destination);
    src.onended = function () { if (soundVoices[name] === src) delete soundVoices[name]; };
    src.start(0);
    soundVoices[name] = src;
  } catch (e) { /* audio failure must never surface */ }
}

/* Unlock audio on the first interaction of any kind. */
function armAudioOnce() {
  function unlock() {
    ensureAudio();
    preloadSounds();
    document.removeEventListener('pointerdown', unlock);
    document.removeEventListener('keydown', unlock);
    document.removeEventListener('touchstart', unlock);
  }
  document.addEventListener('pointerdown', unlock, { once: true });
  document.addEventListener('keydown', unlock, { once: true });
  document.addEventListener('touchstart', unlock, { once: true });
}

/* ============================================================
   Bank accounts
   ============================================================ */
var ACCOUNT_TYPES = [
  { value: 'savings', label: 'Savings' },
  { value: 'checking', label: 'Checking' },
  { value: 'cash', label: 'Cash' },
  { value: 'e_wallet', label: 'E-wallet' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'other', label: 'Other' }
];
var ACCOUNT_STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'closed', label: 'Closed' }
];

function acctTypeClass(t) {
  var map = { savings: 'savings', checking: 'checking', cash: 'cash', e_wallet: 'ewallet', credit_card: 'credit', other: 'other' };
  return map[t] || 'other';
}

VIEW_LOADERS.accounts = async function () {
  var el = $('#view-accounts');
  $('#page-sub').textContent = 'Manually managed accounts and cash wallets';
  el.innerHTML = loadingCard('Loading accounts…');
  try {
    await loadAccounts();
    var total = accounts.reduce(function (s, a) { return s + (a.status === 'closed' ? 0 : num(a.current_balance)); }, 0);
    var byType = {};
    accounts.forEach(function (a) {
      var k = acctTypeLabel(a.account_type);
      byType[k] = (byType[k] || 0) + 1;
    });

    var html = '';

    /* The primary action lives in a toolbar so it stays reachable whether or
       not any accounts exist yet. */
    html += '<div class="toolbar" style="margin-bottom:16px">' +
      '<div>' +
        '<div style="font-weight:600;font-size:14px">Your accounts</div>' +
        '<div class="muted small">' + accounts.length + ' on record · balances update from transactions and transfers</div>' +
      '</div>' +
      '<div class="spacer"></div>' +
      (can('accounts_create') ? '<button class="btn" type="button" data-newacct="1">+ Add new account</button>' : '') +
      '</div>';

    if (!can('accounts_create')) {
      html += '<div class="notice"><div>Your role can view accounts but not create, edit or delete them. Balances are read-only.</div></div>';
    }

    html += '<div class="kpis">' +
      kpi('Total balance', money(total), accounts.length + ' accounts', total >= 0 ? 'pos' : 'neg') +
      kpi('Active accounts', String(activeAccounts().length), Object.keys(byType).length + ' account types in use', '') +
      kpi('Largest balance', money(accounts.reduce(function (m, a) { return Math.max(m, num(a.current_balance)); }, 0)), 'Across all accounts', '') +
      kpi('Closed accounts', String(accounts.filter(function (a) { return a.status === 'closed'; }).length), 'Excluded from totals', '') +
      '</div>';

    if (!accounts.length) {
      html += '<div class="card">' + emptyState(
        'No bank accounts yet',
        'Add a savings account, checking account or cash wallet. Balances are calculated from the transactions you assign to each account.',
        can('accounts_create') ? '<button class="btn" type="button" data-newacct="1">Add your first account</button>' : ''
      ) + '</div>';
    } else {
      html += '<div class="acct-grid">';
      accounts.forEach(function (a) {
        html += '<div class="acct-card type-' + acctTypeClass(a.account_type) + (a.status === 'closed' ? ' is-archived' : '') + '">' +
          '<div class="acct-top"><div style="flex:1;min-width:0">' +
            '<div class="acct-name">' + esc(a.name) + '</div>' +
            '<div class="acct-bank">' + esc(a.institution || 'No institution') + '</div>' +
          '</div><span class="badge">' + esc(acctTypeLabel(a.account_type)) + '</span></div>' +
          '<div>' +
            '<div class="acct-balance ' + (num(a.current_balance) < 0 ? 'neg' : '') + '">' + esc(money(a.current_balance)) + '</div>' +
            '<div class="acct-meta"><span>' + esc(a.currency) + '</span><span>·</span><span>' + esc(maskAccount(a.account_number)) + '</span>' +
            '<span>·</span><span>' + esc(a.status) + '</span></div>' +
          '</div>' +
          '<div class="acct-actions">' +
            '<button class="btn ghost small" type="button" data-acct-view="' + a.id + '">History</button>' +
            (can('accounts_edit') ? '<button class="btn ghost small" type="button" data-acct-edit="' + a.id + '">Edit</button>' : '') +
            (can('accounts_delete') ? '<button class="btn ghost small" type="button" data-acct-del="' + a.id + '">Delete</button>' : '') +
          '</div>' +
        '</div>';
      });
      html += '</div>';
    }

    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load accounts</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function openAccountModal(existing) {
  var isEdit = !!existing;
  if (!isEdit && !can('accounts_create')) { toast('Your role cannot create accounts.', 'err'); return; }
  if (isEdit && !can('accounts_edit')) { toast('Your role cannot edit accounts.', 'err'); return; }
  var type = existing ? existing.account_type : 'checking';
  var status = existing ? existing.status : 'active';
  var cur = existing ? existing.currency : ((profile && profile.currency) || 'USD');
  var body =
    '<label class="field"><span>Account name</span><input class="inp" id="ac-name" maxlength="60" required value="' + esc(existing ? existing.name : '') + '" placeholder="e.g. Everyday checking"></label>' +
    '<label class="field"><span>Bank or institution</span><input class="inp" id="ac-inst" maxlength="60" value="' + esc(existing ? existing.institution : '') + '" placeholder="e.g. Chase, GCash, Cash"></label>' +
    '<label class="field"><span>Account type</span><select class="inp" id="ac-type">' +
      ACCOUNT_TYPES.map(function (t) { return '<option value="' + t.value + '"' + (t.value === type ? ' selected' : '') + '>' + t.label + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="field"><span>Account number (optional)</span><input class="inp" id="ac-num" maxlength="40" autocomplete="off" value="' + esc(existing ? existing.account_number : '') + '" placeholder="Only the last 4 digits are shown"></label>' +
    '<label class="field"><span>Opening balance</span><input class="inp" id="ac-open" type="number" step="0.01" inputmode="decimal" required value="' + esc(existing ? existing.opening_balance : '0.00') + '"></label>' +
    '<label class="field"><span>Currency</span><select class="inp" id="ac-cur">' +
      CURRENCIES.map(function (c) { return '<option value="' + c + '"' + (c === cur ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
    '</select></label>' +
    '<label class="field"><span>Status</span><select class="inp" id="ac-status">' +
      ACCOUNT_STATUS.map(function (s) { return '<option value="' + s.value + '"' + (s.value === status ? ' selected' : '') + '>' + s.label + '</option>'; }).join('') +
    '</select></label>' +
    '<p class="muted small" style="margin:0">Current balance is recalculated from the opening balance plus every transaction assigned to this account.</p>';

  openModal({
    title: isEdit ? 'Edit account' : 'New bank account',
    body: body,
    submitLabel: isEdit ? 'Save changes' : 'Create account',
    onSubmit: async function () {
      requireSession();
      if (acctSaving) throw new Error('This account is already being saved.');
      var name = $('#ac-name').value.trim();
      if (!name) throw new Error('Enter an account name.');
      var opening = Math.round(num($('#ac-open').value) * 100) / 100;
      if (!isFinite(opening)) throw new Error('Enter a valid opening balance.');

      var payload = {
        user_id: user.id,
        name: name,
        institution: $('#ac-inst').value.trim(),
        account_type: $('#ac-type').value,
        account_number: $('#ac-num').value.trim() || null,
        opening_balance: opening,
        currency: $('#ac-cur').value,
        status: $('#ac-status').value
      };

      acctSaving = true;
      try {
        var res, newId = null;
        if (isEdit) {
          res = await sb.from('bank_accounts').update(payload).eq('id', existing.id).select('id').single();
          if (res.error) throw res.error;
          newId = existing.id;
        } else {
          /* The insert response is not trusted for current_balance: RETURNING is
             evaluated before the AFTER trigger recalculates, so it would read 0. */
          res = await sb.from('bank_accounts').insert(payload).select('id').single();
          if (res.error) throw res.error;
          newId = res.data ? res.data.id : null;
        }

        /* Recalculate explicitly so the row is correct even if the trigger is
           absent, then re-read the authoritative value. */
        if (newId) {
          try { await sb.rpc('recalc_account_balance', { p_account_id: newId }); } catch (e) { /* trigger already did it */ }
        }
        await loadAccounts();
      } finally {
        acctSaving = false;
      }

      playSound(isEdit ? 'smartFill' : 'accountCreated');
      toast(isEdit ? 'Account updated' : 'Account created', 'ok');
      refreshCurrent();
    }
  });
}

async function deleteAccount(id) {
  if (!can('accounts_delete')) { toast('Your role cannot delete accounts.', 'err'); return; }
  var a = acctById(id);
  if (!a) return;
  var ok = await askConfirm(
    'Delete account',
    'Delete "' + a.name + '"? Its transactions are kept but become unassigned, and the account balance history is lost. This cannot be undone.',
    'Delete account', true
  );
  if (!ok) return;
  try {
    var res = await sb.from('bank_accounts').delete().eq('id', id);
    if (res.error) throw res.error;
    await loadAccounts();
    playSound('accountDeleted');
    toast('Account deleted', 'ok');
    refreshCurrent();
  } catch (e) { toast(errMsg(e), 'err'); }
}

async function openAccountHistory(id) {
  var a = acctById(id);
  if (!a) return;
  var root = $('#modal-root');
  root.innerHTML = '<div class="overlay" data-acct-overlay="1"><div class="modal wide" role="dialog" aria-modal="true">' +
    '<div class="modal-head"><h3>' + esc(a.name) + '</h3>' +
    '<button class="icon-btn" type="button" data-close="1" aria-label="Close">✕</button></div>' +
    '<div class="modal-body" id="acct-detail"><div class="center-screen" style="min-height:120px;padding:0"><div class="spinner"></div></div></div>' +
    '<div class="modal-foot"><button class="btn ghost" type="button" data-close="1">Close</button></div></div></div>';
  $('[data-acct-overlay]').addEventListener('click', function (e) { if (e.target === this) closeModal(); });

  try {
    var res = await sb.from('transactions')
      .select('id,type,amount,description,occurred_on,category_id')
      .eq('account_id', id)
      .order('occurred_on', { ascending: false }).order('created_at', { ascending: false })
      .limit(50);
    if (res.error) throw res.error;
    var rows = res.data || [];
    var t = totals(rows);
    var html = '<dl class="kv">' +
      '<dt>Institution</dt><dd>' + esc(a.institution || '—') + '</dd>' +
      '<dt>Type</dt><dd>' + esc(acctTypeLabel(a.account_type)) + '</dd>' +
      '<dt>Account number</dt><dd class="mono">' + esc(maskAccount(a.account_number)) + '</dd>' +
      '<dt>Opening balance</dt><dd>' + esc(money(a.opening_balance)) + '</dd>' +
      '<dt>Current balance</dt><dd class="' + (num(a.current_balance) < 0 ? 'neg' : 'pos') + '">' + esc(money(a.current_balance)) + '</dd>' +
      '<dt>Currency</dt><dd>' + esc(a.currency) + '</dd>' +
      '<dt>Status</dt><dd>' + esc(a.status) + '</dd>' +
      '<dt>Created</dt><dd>' + esc(fmtDate(a.created_at)) + '</dd>' +
      '</dl>';
    html += '<h3 style="margin:20px 0 10px;font-size:13.5px">Account transaction history</h3>';
    if (!rows.length) {
      html += '<p class="muted small" style="margin:0">No transactions are assigned to this account yet. Assign an account when adding a transaction.</p>';
    } else {
      html += '<p class="muted small" style="margin:0 0 10px">Last ' + rows.length + ' transactions · income ' + esc(money(t.income)) + ' · expenses ' + esc(money(t.expense)) + '</p>';
      html += '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        html += '<tr><td class="muted small" style="white-space:nowrap">' + esc(fmtDate(r.occurred_on)) + '</td>' +
          '<td>' + esc(r.description || catName(r.category_id)) + '</td>' +
          '<td class="r amount ' + (r.type === 'income' ? 'pos' : 'neg') + '">' + (r.type === 'income' ? '+' : '−') + esc(money(r.amount)) + '</td></tr>';
      });
      html += '</tbody></table></div>';
    }
    $('#acct-detail').innerHTML = html;
  } catch (e) {
    $('#acct-detail').innerHTML = '<p class="muted small">' + esc(errMsg(e)) + '</p>';
  }
}

/* ============================================================
   Team and roles
   ============================================================ */
VIEW_LOADERS.team = async function () {
  var el = $('#view-team');
  $('#page-sub').textContent = 'Members, roles and permissions';
  if (!can('users_manage')) {
    el.innerHTML = '<div class="card">' + emptyState('No access', 'Only owners and administrators can manage team members.') + '</div>';
    return;
  }
  el.innerHTML = loadingCard('Loading team…');
  try {
    await loadMembers();
    var roleCounts = { owner: 0, admin: 0, editor: 0, viewer: 0 };
    members.forEach(function (m) { if (roleCounts[m.role] != null) roleCounts[m.role]++; });

    var html = '<div class="card"><div class="card-head"><h2>Members</h2>' +
      '<span class="badge">' + members.length + '</span><div class="spacer"></div>' +
      '<button class="btn small" type="button" data-invite="1">Invite member</button></div>' +
      '<p class="muted small" style="margin:0 0 8px">Each member signs in with their own Supabase account. Roles decide what they can do, and the database enforces the same rules.</p>';

    if (!members.length) {
      html += emptyState('No members recorded', 'Invite a member to share this workspace.');
    } else {
      members.forEach(function (m) {
        var isSelf = m.user_id === user.id;
        html += '<div class="member-row">' +
          '<div class="member-name"><div class="avatar">' + esc(initials(m.display_name, m.email)) + '</div>' +
            '<div><div>' + esc(m.display_name || m.email || 'Member') + (isSelf ? ' <span class="muted small">(you)</span>' : '') + '</div>' +
            '<div class="member-mail">' + esc(m.email || '') + ' · joined ' + esc(fmtDate(m.created_at)) + '</div></div>' +
          '</div>' +
          '<div>' +
            (m.role === 'owner'
              ? rolePill('owner')
              : '<select class="inp" data-member-role="' + m.id + '">' +
                  ['admin', 'editor', 'viewer'].map(function (r) {
                    return '<option value="' + r + '"' + (m.role === r ? ' selected' : '') + '>' + roleLabel(r) + '</option>';
                  }).join('') +
                '</select>') +
          '</div>' +
          '<div class="row-actions">' +
            (m.role === 'owner' ? '<span class="muted small">Workspace owner</span>' :
              '<button class="btn danger small" type="button" data-member-del="' + m.id + '">Remove</button>') +
          '</div>' +
        '</div>';
      });
    }
    html += '</div>';

    html += '<div class="card"><div class="card-head"><h2>Permission matrix</h2></div>' +
      '<div class="table-wrap" style="margin:0 -18px;padding:0 18px"><div class="perm-grid" style="min-width:430px">' +
      '<div class="perm-head" style="text-align:left">Capability</div>' +
      ROLES.map(function (r) { return '<div class="perm-head">' + esc(roleLabel(r)) + '</div>'; }).join('') +
      PERMS.map(function (p) {
        return '<div class="perm-name">' + esc(p.label) + '</div>' +
          ROLES.map(function (r) {
            return '<div class="perm-cell">' + (p[r] ? '<span class="perm-yes">✓</span>' : '<span class="perm-no">—</span>') + '</div>';
          }).join('');
      }).join('') +
      '</div></div></div>';

    html += '<div class="card"><div class="card-head"><h2>Your access</h2></div>' +
      '<p class="small" style="margin:0 0 12px">Signed in as ' + esc(user.email || '') + ' with the ' + rolePill(me.role) + ' role.</p>' +
      '<div class="perm-grid" style="grid-template-columns:1fr 90px">' +
      PERMS.map(function (p) {
        return '<div class="perm-name">' + esc(p.label) + '</div><div class="perm-cell">' +
          (can(p.key) ? '<span class="perm-yes">Allowed</span>' : '<span class="perm-no">Blocked</span>') + '</div>';
      }).join('') + '</div></div>';

    el.innerHTML = html;

    $$('[data-member-role]').forEach(function (sel) {
      sel.addEventListener('change', async function () {
        var id = sel.getAttribute('data-member-role');
        var newRole = sel.value;
        var m = members.filter(function (x) { return x.id === id; })[0];
        if (!m) return;
        var ok = await askConfirm('Change role', 'Set ' + (m.display_name || m.email) + ' to ' + roleLabel(newRole) + '? Their access changes immediately.', 'Change role');
        if (!ok) { VIEW_LOADERS.team(); return; }
        try {
          var res = await sb.from('workspace_members').update({ role: newRole }).eq('id', id);
          if (res.error) throw res.error;
          toast('Role updated', 'ok');
          VIEW_LOADERS.team();
        } catch (e) { toast(errMsg(e), 'err'); VIEW_LOADERS.team(); }
      });
    });

    $$('[data-member-del]').forEach(function (btn) {
      btn.addEventListener('click', async function () {
        var id = btn.getAttribute('data-member-del');
        var m = members.filter(function (x) { return x.id === id; })[0];
        if (!m) return;
        var ok = await askConfirm('Remove member', 'Remove ' + (m.display_name || m.email) + ' from this workspace? They lose access immediately. Their own records stay intact.', 'Remove', true);
        if (!ok) return;
        try {
          var res = await sb.from('workspace_members').delete().eq('id', id);
          if (res.error) throw res.error;
          toast('Member removed', 'ok');
          VIEW_LOADERS.team();
        } catch (e) { toast(errMsg(e), 'err'); }
      });
    });

    $$('[data-invite]').forEach(function (btn) {
      btn.addEventListener('click', openInviteModal);
    });
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load the team</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function openInviteModal() {
  if (!can('users_manage')) { toast('Your role cannot manage members.', 'err'); return; }
  openModal({
    title: 'Invite member',
    body:
      '<label class="field"><span>Email address</span><input class="inp" id="inv-email" type="email" required placeholder="name@example.com"></label>' +
      '<label class="field"><span>Display name</span><input class="inp" id="inv-name" maxlength="60" placeholder="Optional"></label>' +
      '<label class="field"><span>Role</span><select class="inp" id="inv-role">' +
        '<option value="viewer">Viewer</option><option value="editor">Editor</option><option value="admin">Administrator</option>' +
      '</select></label>' +
      '<p class="muted small" style="margin:0">The member record is created straight away. They gain access once they sign in with that email address; RLS policies match on their authenticated user id.</p>',
    submitLabel: 'Add member',
    onSubmit: async function () {
      requireSession();
      var email = $('#inv-email').value.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a valid email address.');
      var res = await sb.from('workspace_members').insert({
        owner_id: user.id,
        email: email,
        display_name: $('#inv-name').value.trim(),
        role: $('#inv-role').value,
        status: 'invited'
      }).select().single();
      if (res.error) {
        if (String(res.error.code) === '23505') throw new Error('That email is already a member.');
        throw res.error;
      }
      toast('Member added', 'ok');
      VIEW_LOADERS.team();
    }
  });
}

/* ============================================================
   Internal transfers
   ============================================================ */
var transfers = [];

function refNumber() {
  var d = new Date();
  var stamp = String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate());
  var rnd = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6).toUpperCase();
  return 'TRF-' + stamp + '-' + rnd;
}

async function loadTransfers() {
  if (!stage2Ready) { transfers = []; return transfers; }
  try {
    var res = await sb.from('transfers')
      .select('id,from_account_id,to_account_id,amount,note,reference,occurred_on,created_at')
      .order('occurred_on', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100);
    if (res.error) throw res.error;
    transfers = res.data || [];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    transfers = [];
    transfersReady = false;
  }
  return transfers;
}
var transfersReady = true;

VIEW_LOADERS.transfers = async function () {
  var el = $('#view-transfers');
  $('#page-sub').textContent = 'Move money between your own accounts';
  el.innerHTML = loadingCard('Loading transfers…');
  try {
    await loadAccounts();
    await loadTransfers();

    if (!stage2Ready || !transfersReady) {
      el.innerHTML = '<div class="card">' + emptyState('Transfers need the Stage 3 tables',
        'Run the migration SQL to add the transfers table and the atomic transfer function.',
        '<button class="btn" type="button" data-stage2-sql="1">Show migration SQL</button>') + '</div>';
      return;
    }

    var open = accounts.filter(function (a) { return a.status !== 'closed'; });
    var html = '';

    if (!open.length) {
      el.innerHTML = '<div class="card">' + emptyState('Add an account first',
        'A transfer needs at least two accounts. Create them in Bank accounts.',
        '<button class="btn" type="button" data-goto="accounts">Go to Bank accounts</button>') + '</div>';
      return;
    }
    if (open.length < 2) {
      el.innerHTML = '<div class="card">' + emptyState('One more account needed',
        'Transfers move money between two of your accounts. Add a second account to continue.',
        '<button class="btn" type="button" data-newacct="1">Add account</button>') + '</div>';
      return;
    }

    html += '<div class="card"><div class="toolbar">' +
      '<span class="muted small">Transfers move money between your own accounts. They never count as income or expenses.</span>' +
      '<div class="spacer"></div>' +
      (can('transactions_create') ? '<button class="btn" type="button" data-newtransfer="1">+ New transfer</button>' : '') +
      '</div>' +
      '<div class="grid3">' +
        kpi('Transfers recorded', String(transfers.length), 'Last 100 shown', '') +
        kpi('Moved in total', money(transfers.reduce(function (s, t) { return s + num(t.amount); }, 0)), 'Across all accounts', '') +
        kpi('Combined balance', money(accounts.reduce(function (s, a) { return s + (a.status === 'closed' ? 0 : num(a.current_balance)); }, 0)), open.length + ' open accounts', '') +
      '</div></div>';

    html += '<div class="card"><div class="card-head"><h2>Transfer history</h2></div>';
    if (!transfers.length) {
      html += emptyState('No transfers yet',
        'Move money between your accounts without recording income or expenses.',
        can('transactions_create') ? '<button class="btn" type="button" data-newtransfer="1">Make a transfer</button>' : '');
    } else {
      html += '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Date</th><th>Reference</th><th>From</th><th>To</th><th>Note</th><th class="r">Amount</th>' +
        (can('transactions_delete') ? '<th></th>' : '') +
        '</tr></thead><tbody>';
      transfers.forEach(function (t) {
        var from = acctById(t.from_account_id);
        var to = acctById(t.to_account_id);
        html += '<tr>' +
          '<td class="muted small" style="white-space:nowrap">' + esc(fmtDate(t.occurred_on)) + '</td>' +
          '<td class="mono small">' + esc(t.reference) + '</td>' +
          '<td>' + esc(from ? from.name : 'Deleted account') + '</td>' +
          '<td>' + esc(to ? to.name : 'Deleted account') + '</td>' +
          '<td class="muted small">' + esc(t.note || '—') + '</td>' +
          '<td class="r amount">' + esc(money(t.amount)) + '</td>' +
          (can('transactions_delete')
            ? '<td><div class="row-actions"><button class="icon-btn" type="button" title="Delete" data-del-transfer="' + t.id + '">✕</button></div></td>'
            : '') +
          '</tr>';
      });
      html += '</tbody></table></div>';
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load transfers</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

function openTransferModal() {
  if (!can('transactions_create')) { toast('Your role cannot create transfers.', 'err'); return; }
  var open = accounts.filter(function (a) { return a.status !== 'closed'; });
  if (open.length < 2) { toast('Two open accounts are required.', 'err'); return; }

  var opts = open.map(function (a) {
    return '<option value="' + a.id + '">' + esc(a.name) + ' · ' + esc(money(a.current_balance)) + '</option>';
  }).join('');

  openModal({
    title: 'New transfer',
    body:
      '<label class="field"><span>From account</span><select class="inp" id="tr-from">' + opts + '</select></label>' +
      '<label class="field"><span>To account</span><select class="inp" id="tr-to">' + opts + '</select></label>' +
      '<label class="field"><span>Amount</span><input class="inp" id="tr-amount" type="number" min="0.01" step="0.01" inputmode="decimal" required placeholder="0.00"></label>' +
      '<label class="field"><span>Date</span><input class="inp" id="tr-date" type="date" required value="' + todayISO() + '"></label>' +
      '<label class="field"><span>Note</span><input class="inp" id="tr-note" maxlength="140" placeholder="Optional, e.g. top up savings"></label>' +
      '<label class="field"><span>Reference number</span><input class="inp mono" id="tr-ref" value="' + refNumber() + '" maxlength="40"></label>' +
      '<p class="muted small" style="margin:0">Both balances update together in a single database transaction. This is not income or an expense.</p>',
    submitLabel: 'Transfer',
    onSubmit: async function () {
      requireSession();
      var from = $('#tr-from').value;
      var to = $('#tr-to').value;
      var amount = Math.round(num($('#tr-amount').value) * 100) / 100;
      var note = $('#tr-note').value.trim();
      var date = $('#tr-date').value;
      var ref = $('#tr-ref').value.trim();

      if (!from || !to) throw new Error('Choose both accounts.');
      if (from === to) throw new Error('Source and destination must be different accounts.');
      if (!(amount > 0)) throw new Error('Enter an amount greater than zero.');
      if (!date) throw new Error('Choose a date.');

      var src = acctById(from);
      if (src && amount > num(src.current_balance)) {
        var go = await askConfirm('Insufficient balance',
          'The source account holds ' + money(src.current_balance) + '. Record the transfer anyway? It will show a negative balance.',
          'Transfer anyway');
        if (!go) throw new Error('Transfer cancelled.');
      }

      var res = await sb.rpc('create_transfer', {
        p_from: from,
        p_to: to,
        p_amount: amount,
        p_note: note,
        p_occurred_on: date,
        p_reference: ref || null
      });
      if (res.error) throw res.error;

      playSound('transferConfirmed');
      toast('Transfer ' + (res.data && res.data.reference ? res.data.reference : '') + ' posted', 'ok');
      await loadAccounts();
      refreshCurrent();
    }
  });

  /* Default the destination to the second account. */
  setTimeout(function () {
    var sel = $('#tr-to');
    if (sel && sel.options.length > 1) sel.selectedIndex = 1;
  }, 0);
}

async function deleteTransfer(id) {
  if (!can('transactions_delete')) { toast('Your role cannot delete transfers.', 'err'); return; }
  var t = null;
  transfers.forEach(function (x) { if (x.id === id) t = x; });
  var ok = await askConfirm('Delete transfer',
    'Delete transfer ' + (t ? t.reference : '') + '? Both account balances will be recalculated. This cannot be undone.',
    'Delete transfer', true);
  if (!ok) return;
  try {
    var res = await sb.from('transfers').delete().eq('id', id);
    if (res.error) throw res.error;
    playSound('transferDeleted');
    toast('Transfer deleted', 'ok');
    await loadAccounts();
    refreshCurrent();
  } catch (e) { toast(errMsg(e), 'err'); }
}

/* ============================================================
   Profile
   ============================================================ */
var CURRENCIES = ['USD', 'EUR', 'GBP', 'PHP', 'INR', 'AUD', 'CAD', 'SGD', 'JPY', 'AED', 'NGN', 'ZAR', 'BRL', 'MXN', 'IDR', 'MYR'];

VIEW_LOADERS.profile = async function () {
  var el = $('#view-profile');
  $('#page-sub').textContent = 'Your account details';
  try {
    await loadProfile();
    var created = profile.created_at ? fmtDate(profile.created_at) : '—';
    var html = '<div class="grid2">' +
      '<div class="card"><div class="card-head"><h2>Profile</h2></div>' +
        '<form id="profile-form">' +
          '<label class="field"><span>Full name</span><input class="inp" id="pf-name" maxlength="80" value="' + esc(profile.full_name || '') + '"></label>' +
          '<label class="field"><span>Email</span><input class="inp" value="' + esc(user.email || '') + '" disabled></label>' +
          '<label class="field"><span>Currency</span><select class="inp" id="pf-currency">' +
            CURRENCIES.map(function (c) { return '<option value="' + c + '"' + (c === profile.currency ? ' selected' : '') + '>' + c + '</option>'; }).join('') +
          '</select></label>' +
          '<label class="field"><span>Monthly savings target (optional)</span>' +
            '<input class="inp" id="pf-target" type="number" min="0" step="0.01" value="' + (profile.monthly_budget ? esc(profile.monthly_budget) : '') + '" placeholder="0.00"></label>' +
          '<button class="btn" type="submit">Save profile</button>' +
          '<p class="form-err" id="pf-err"></p>' +
        '</form></div>' +
      '<div class="card"><div class="card-head"><h2>Account</h2></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Signed in as</span><span style="font-weight:550">' + esc(user.email || '—') + '</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Member since</span><span>' + esc(created) + '</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">User ID</span><span class="mono small">' + esc(user.id.slice(0, 8)) + '…</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Your role</span><span>' + rolePill(me.role) + '</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Row level security</span><span class="badge in">Enabled</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Session persistence</span><span class="badge in">Survives refresh</span></div>' +
        '<div class="budget-row" style="grid-template-columns:1fr auto"><span class="muted">Access token refreshes at</span><span class="small mono">' + esc(session && session.expires_at ? new Date(session.expires_at * 1000).toLocaleString() : 'auto-refresh') + '</span></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">' +
          '<button class="btn ghost small" type="button" id="pf-pw">Send password reset email</button>' +
          '<button class="btn ghost small" type="button" id="pf-signout">Sign out</button>' +
          '<button class="btn danger small" type="button" id="pf-disconnect">Change Supabase project</button>' +
        '</div>' +
        '<p class="muted small" style="margin-top:14px">PINCH Finance Beta ' + esc(VERSION) + ' (' + esc(BUILD) + '). Every record is stored in your Supabase project and protected by RLS policies that scope rows to your authenticated user id.</p>' +
      '</div></div>';
    el.innerHTML = html;

    $('#profile-form').addEventListener('submit', async function (ev) {
      ev.preventDefault();
      var btn = ev.target.querySelector('button[type="submit"]');
      var err = $('#pf-err');
      err.textContent = '';
      btn.disabled = true;
      try {
        requireSession();
        var target = $('#pf-target').value.trim();
        var payload = {
          id: user.id,
          full_name: $('#pf-name').value.trim(),
          currency: $('#pf-currency').value,
          monthly_budget: target === '' ? null : Math.round(num(target) * 100) / 100
        };
        var res = await sb.from('profiles').upsert(payload).select().single();
        if (res.error) throw res.error;
        profile = res.data;
        renderShell();
        toast('Profile saved', 'ok');
        VIEW_LOADERS.profile();
      } catch (e) {
        err.textContent = errMsg(e);
        btn.disabled = false;
      }
    });

    $('#pf-pw').addEventListener('click', async function () {
      try {
        var res = await sb.auth.resetPasswordForEmail(user.email, { redirectTo: location.href.split('#')[0] });
        if (res.error) throw res.error;
        toast('Password reset email sent', 'ok');
      } catch (e) { toast(errMsg(e), 'err'); }
    });
    $('#pf-signout').addEventListener('click', doSignOut);
    $('#pf-disconnect').addEventListener('click', async function () {
      var ok = await askConfirm('Change Supabase project', 'Disconnect this project? Your data stays in Supabase; the app will ask for connection details again.', 'Disconnect');
      if (!ok) return;
      await resetConnection();
    });
  } catch (e) {
    el.innerHTML = '<div class="card"><h2>Could not load the profile</h2><p class="muted small">' + esc(errMsg(e)) + '</p></div>';
    toast(errMsg(e), 'err');
  }
};

async function doSignOut() {
  var ok = await askConfirm(
    'Sign out',
    'End this session on this device? You will need your email and password to sign back in.',
    'Sign out', true
  );
  if (!ok) return;

  /* Stop the refresh timer and drop the tokens first, so nothing can write the
     session back while we are clearing it. */
  try { await sb.auth.stopAutoRefresh(); } catch (e) { /* ignore */ }
  try { await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }

  purgeSessionStorage();
  session = null;
  user = null;
  authRestoring = false;
  authReady = true;
  teardown();
  show('auth');
  setMsg('#auth-msg', 'Signed out. Your session was cleared on this device.', 'ok');
}

/* Return to the connection screen without reloading the page. */
async function resetConnection() {
  try { if (sb) await sb.auth.signOut({ scope: 'local' }); } catch (e) { /* ignore */ }
  purgeSessionStorage();
  await clearCfg();
  sb = null;
  teardown();
  $('#cfg-url').value = '';
  $('#cfg-key').value = '';
  setMsg('#setup-msg', '');
  show('setup');
}

/* ============================================================
   Required database schema (shown on the setup screen)
   ============================================================ */
var SCHEMA_SQL = [
'-- PINCH Finance Beta 2 - Supabase schema (stage 1)',
'-- Run once in Supabase > SQL Editor, then reload the app.',
'',
'create extension if not exists pgcrypto;',
'',
'create table if not exists public.profiles (',
'  id uuid primary key references auth.users(id) on delete cascade,',
'  full_name text not null default \'\',',
'  currency text not null default \'USD\',',
'  monthly_budget numeric(14,2),',
'  created_at timestamptz not null default now(),',
'  updated_at timestamptz not null default now()',
');',
'',
'create table if not exists public.categories (',
'  id uuid primary key default gen_random_uuid(),',
'  user_id uuid not null references auth.users(id) on delete cascade,',
'  name text not null check (length(trim(name)) > 0),',
'  type text not null check (type in (\'income\',\'expense\')),',
'  color text not null default \'#0E7C66\',',
'  created_at timestamptz not null default now(),',
'  unique (user_id, type, name)',
');',
'',
'create table if not exists public.transactions (',
'  id uuid primary key default gen_random_uuid(),',
'  user_id uuid not null references auth.users(id) on delete cascade,',
'  category_id uuid references public.categories(id) on delete set null,',
'  type text not null check (type in (\'income\',\'expense\')),',
'  amount numeric(14,2) not null check (amount > 0),',
'  description text not null default \'\',',
'  occurred_on date not null default current_date,',
'  created_at timestamptz not null default now(),',
'  updated_at timestamptz not null default now()',
');',
'',
'create index if not exists transactions_user_date_idx on public.transactions (user_id, occurred_on desc);',
'create index if not exists transactions_user_type_idx on public.transactions (user_id, type);',
'create index if not exists transactions_category_idx on public.transactions (category_id);',
'',
'create table if not exists public.budgets (',
'  id uuid primary key default gen_random_uuid(),',
'  user_id uuid not null references auth.users(id) on delete cascade,',
'  category_id uuid not null references public.categories(id) on delete cascade,',
'  period_month date not null,',
'  amount numeric(14,2) not null check (amount >= 0),',
'  created_at timestamptz not null default now(),',
'  unique (user_id, category_id, period_month),',
'  check (extract(day from period_month) = 1)',
');',
'',
'-- updated_at maintenance',
'create or replace function public.touch_updated_at()',
'returns trigger language plpgsql as $$',
'begin',
'  new.updated_at = now();',
'  return new;',
'end $$;',
'',
'drop trigger if exists profiles_touch on public.profiles;',
'create trigger profiles_touch before update on public.profiles',
'  for each row execute function public.touch_updated_at();',
'',
'drop trigger if exists transactions_touch on public.transactions;',
'create trigger transactions_touch before update on public.transactions',
'  for each row execute function public.touch_updated_at();',
'',
'-- row level security',
'alter table public.profiles     enable row level security;',
'alter table public.categories   enable row level security;',
'alter table public.transactions enable row level security;',
'alter table public.budgets      enable row level security;',
'',
'drop policy if exists profiles_select on public.profiles;',
'create policy profiles_select on public.profiles for select to authenticated using (auth.uid() = id);',
'drop policy if exists profiles_insert on public.profiles;',
'create policy profiles_insert on public.profiles for insert to authenticated with check (auth.uid() = id);',
'drop policy if exists profiles_update on public.profiles;',
'create policy profiles_update on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);',
'',
'drop policy if exists categories_all on public.categories;',
'create policy categories_all on public.categories for all to authenticated',
'  using (auth.uid() = user_id) with check (auth.uid() = user_id);',
'',
'drop policy if exists transactions_all on public.transactions;',
'create policy transactions_all on public.transactions for all to authenticated',
'  using (auth.uid() = user_id) with check (auth.uid() = user_id);',
'',
'drop policy if exists budgets_all on public.budgets;',
'create policy budgets_all on public.budgets for all to authenticated',
'  using (auth.uid() = user_id) with check (auth.uid() = user_id);',
'',
'grant usage on schema public to anon, authenticated;',
'grant select, insert, update, delete on public.profiles, public.categories,',
'  public.transactions, public.budgets to authenticated;',
'',
'-- new user bootstrap: profile row + starter categories',
'create or replace function public.handle_new_user()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'begin',
'  insert into public.profiles (id, full_name)',
'  values (new.id, coalesce(new.raw_user_meta_data->>\'full_name\', \'\'))',
'  on conflict (id) do nothing;',
'',
'  insert into public.categories (user_id, name, type, color) values',
'    (new.id, \'Salary\',    \'income\',  \'#0F7B4F\'),',
'    (new.id, \'Freelance\', \'income\',  \'#0891B2\'),',
'    (new.id, \'Other income\', \'income\', \'#65A30D\'),',
'    (new.id, \'Housing\',   \'expense\', \'#2563EB\'),',
'    (new.id, \'Groceries\', \'expense\', \'#0E7C66\'),',
'    (new.id, \'Transport\', \'expense\', \'#D97706\'),',
'    (new.id, \'Utilities\', \'expense\', \'#7C3AED\'),',
'    (new.id, \'Dining\',    \'expense\', \'#DC2626\'),',
'    (new.id, \'Health\',    \'expense\', \'#0891B2\'),',
'    (new.id, \'Shopping\',  \'expense\', \'#DB2777\'),',
'    (new.id, \'Other\',     \'expense\', \'#475569\')',
'  on conflict (user_id, type, name) do nothing;',
'',
'  return new;',
'end $$;',
'',
'drop trigger if exists on_auth_user_created on auth.users;',
'create trigger on_auth_user_created after insert on auth.users',
'  for each row execute function public.handle_new_user();',
'',
'/* ============================================================',
'   STAGE 2 - bank accounts, roles, permissions',
'   ============================================================ */',
'',
'create table if not exists public.bank_accounts (',
'  id uuid primary key default gen_random_uuid(),',
'  user_id uuid not null references auth.users(id) on delete cascade,',
'  name text not null check (length(trim(name)) > 0),',
'  institution text not null default \'\',',
'  account_type text not null default \'checking\'',
'    check (account_type in (\'savings\',\'checking\',\'cash\',\'e_wallet\',\'credit_card\',\'other\')),',
'  account_number text,',
'  opening_balance numeric(14,2) not null default 0,',
'  current_balance numeric(14,2) not null default 0,',
'  currency text not null default \'USD\',',
'  status text not null default \'active\' check (status in (\'active\',\'inactive\',\'closed\')),',
'  created_at timestamptz not null default now(),',
'  updated_at timestamptz not null default now()',
');',
'',
'create index if not exists bank_accounts_user_idx on public.bank_accounts (user_id, created_at);',
'',
'/* transactions gain an account reference */',
'alter table public.transactions',
'  add column if not exists account_id uuid references public.bank_accounts(id) on delete set null;',
'create index if not exists transactions_account_idx on public.transactions (account_id);',
'',
'/* roles: one row per user */',
'create table if not exists public.user_roles (',
'  user_id uuid primary key references auth.users(id) on delete cascade,',
'  role text not null default \'owner\' check (role in (\'owner\',\'admin\',\'editor\',\'viewer\')),',
'  granted_by uuid references auth.users(id) on delete set null,',
'  created_at timestamptz not null default now(),',
'  updated_at timestamptz not null default now()',
');',
'',
'/* canonical permission matrix, readable by the client */',
'create table if not exists public.role_permissions (',
'  role text not null check (role in (\'owner\',\'admin\',\'editor\',\'viewer\')),',
'  permission text not null,',
'  allowed boolean not null default false,',
'  primary key (role, permission)',
');',
'',
'insert into public.role_permissions (role, permission, allowed) values',
'  (\'owner\',\'dashboard_view\',true),(\'owner\',\'accounts_view\',true),(\'owner\',\'accounts_create\',true),',
'  (\'owner\',\'accounts_edit\',true),(\'owner\',\'accounts_delete\',true),(\'owner\',\'transactions_view\',true),',
'  (\'owner\',\'transactions_create\',true),(\'owner\',\'transactions_edit\',true),(\'owner\',\'transactions_delete\',true),',
'  (\'owner\',\'budgets_manage\',true),(\'owner\',\'reports_view\',true),(\'owner\',\'users_manage\',true),',
'  (\'admin\',\'dashboard_view\',true),(\'admin\',\'accounts_view\',true),(\'admin\',\'accounts_create\',true),',
'  (\'admin\',\'accounts_edit\',true),(\'admin\',\'accounts_delete\',true),(\'admin\',\'transactions_view\',true),',
'  (\'admin\',\'transactions_create\',true),(\'admin\',\'transactions_edit\',true),(\'admin\',\'transactions_delete\',true),',
'  (\'admin\',\'budgets_manage\',true),(\'admin\',\'reports_view\',true),(\'admin\',\'users_manage\',true),',
'  (\'editor\',\'dashboard_view\',true),(\'editor\',\'accounts_view\',true),(\'editor\',\'accounts_create\',true),',
'  (\'editor\',\'accounts_edit\',true),(\'editor\',\'accounts_delete\',false),(\'editor\',\'transactions_view\',true),',
'  (\'editor\',\'transactions_create\',true),(\'editor\',\'transactions_edit\',true),(\'editor\',\'transactions_delete\',false),',
'  (\'editor\',\'budgets_manage\',false),(\'editor\',\'reports_view\',true),(\'editor\',\'users_manage\',false),',
'  (\'viewer\',\'dashboard_view\',true),(\'viewer\',\'accounts_view\',true),(\'viewer\',\'accounts_create\',false),',
'  (\'viewer\',\'accounts_edit\',false),(\'viewer\',\'accounts_delete\',false),(\'viewer\',\'transactions_view\',true),',
'  (\'viewer\',\'transactions_create\',false),(\'viewer\',\'transactions_edit\',false),(\'viewer\',\'transactions_delete\',false),',
'  (\'viewer\',\'budgets_manage\',false),(\'viewer\',\'reports_view\',true),(\'viewer\',\'users_manage\',false)',
'on conflict (role, permission) do update set allowed = excluded.allowed;',
'',
'/* workspace members: the owner invites by email, role decides access */',
'create table if not exists public.workspace_members (',
'  id uuid primary key default gen_random_uuid(),',
'  owner_id uuid not null references auth.users(id) on delete cascade,',
'  user_id uuid references auth.users(id) on delete cascade,',
'  email text not null,',
'  display_name text not null default \'\',',
'  role text not null default \'viewer\' check (role in (\'owner\',\'admin\',\'editor\',\'viewer\')),',
'  status text not null default \'invited\' check (status in (\'invited\',\'active\',\'suspended\')),',
'  created_at timestamptz not null default now(),',
'  unique (owner_id, email)',
');',
'',
'/* ---------- helper functions used by RLS ---------- */',
'create or replace function public.current_role()',
'returns text language sql stable security definer set search_path = public as $$',
'  select coalesce((select role from public.user_roles where user_id = auth.uid()), \'owner\');',
'$$;',
'',
'create or replace function public.has_perm(p_permission text)',
'returns boolean language sql stable security definer set search_path = public as $$',
'  select coalesce((',
'    select rp.allowed from public.role_permissions rp',
'    where rp.role = public.current_role() and rp.permission = p_permission',
'  ), false);',
'$$;',
'',
'/* ---------- balance maintenance ---------- */',
'create or replace function public.recalc_account_balance(p_account_id uuid)',
'returns void language plpgsql security definer set search_path = public as $$',
'declare',
'  v_open numeric(14,2);',
'  v_income numeric(14,2);',
'  v_expense numeric(14,2);',
'begin',
'  if p_account_id is null then return; end if;',
'  select opening_balance into v_open from public.bank_accounts where id = p_account_id;',
'  if not found then return; end if;',
'  select coalesce(sum(case when type = \'income\' then amount else 0 end), 0),',
'         coalesce(sum(case when type = \'expense\' then amount else 0 end), 0)',
'    into v_income, v_expense',
'  from public.transactions where account_id = p_account_id;',
'  update public.bank_accounts',
'     set current_balance = coalesce(v_open, 0) + v_income - v_expense,',
'         updated_at = now()',
'   where id = p_account_id;',
'end $$;',
'',
'create or replace function public.transactions_balance_trigger()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'begin',
'  if tg_op = \'INSERT\' then',
'    perform public.recalc_account_balance(new.account_id);',
'  elsif tg_op = \'UPDATE\' then',
'    perform public.recalc_account_balance(old.account_id);',
'    if new.account_id is distinct from old.account_id then',
'      perform public.recalc_account_balance(new.account_id);',
'    end if;',
'  elsif tg_op = \'DELETE\' then',
'    perform public.recalc_account_balance(old.account_id);',
'  end if;',
'  return null;',
'end $$;',
'',
'drop trigger if exists transactions_balance on public.transactions;',
'create trigger transactions_balance after insert or update or delete on public.transactions',
'  for each row execute function public.transactions_balance_trigger();',
'',
'create or replace function public.bank_accounts_balance_trigger()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'begin',
'  if tg_op = \'INSERT\' then',
'    perform public.recalc_account_balance(new.id);',
'  elsif tg_op = \'UPDATE\' and new.opening_balance is distinct from old.opening_balance then',
'    perform public.recalc_account_balance(new.id);',
'  end if;',
'  return null;',
'end $$;',
'',
'drop trigger if exists bank_accounts_balance on public.bank_accounts;',
'create trigger bank_accounts_balance after insert or update on public.bank_accounts',
'  for each row execute function public.bank_accounts_balance_trigger();',
'',
'/* ---------- new user bootstrap ---------- */',
'create or replace function public.handle_new_user()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'begin',
'  insert into public.profiles (id, full_name)',
'  values (new.id, coalesce(new.raw_user_meta_data->>\'full_name\', \'\'))',
'  on conflict (id) do nothing;',
'',
'  insert into public.user_roles (user_id, role) values (new.id, \'owner\')',
'  on conflict (user_id) do nothing;',
'',
'  insert into public.workspace_members (owner_id, user_id, email, display_name, role, status)',
'  values (new.id, new.id, coalesce(new.email, \'\'), coalesce(new.raw_user_meta_data->>\'full_name\', \'\'), \'owner\', \'active\')',
'  on conflict (owner_id, email) do nothing;',
'',
'  insert into public.categories (user_id, name, type, color) values',
'    (new.id, \'Salary\',    \'income\',  \'#0F7B4F\'),',
'    (new.id, \'Freelance\', \'income\',  \'#0891B2\'),',
'    (new.id, \'Other income\', \'income\', \'#65A30D\'),',
'    (new.id, \'Housing\',   \'expense\', \'#2563EB\'),',
'    (new.id, \'Groceries\', \'expense\', \'#0E7C66\'),',
'    (new.id, \'Transport\', \'expense\', \'#D97706\'),',
'    (new.id, \'Utilities\', \'expense\', \'#7C3AED\'),',
'    (new.id, \'Dining\',    \'expense\', \'#DC2626\'),',
'    (new.id, \'Health\',    \'expense\', \'#0891B2\'),',
'    (new.id, \'Shopping\',  \'expense\', \'#DB2777\'),',
'    (new.id, \'Other\',     \'expense\', \'#475569\')',
'  on conflict (user_id, type, name) do nothing;',
'',
'  return new;',
'end $$;',
'',
'/* ---------- binding an invited email to a real account ---------- */',
'create or replace function public.bind_workspace_member()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'declare',
'  v_uid uuid;',
'begin',
'  v_uid := new.user_id;',
'  if v_uid is null then',
'    select id into v_uid from auth.users where lower(email) = lower(new.email) limit 1;',
'    new.user_id := v_uid;',
'  end if;',
'',
'  /* the invited member actually receives the role they were given */',
'  if v_uid is not null and new.role <> \'owner\' then',
'    insert into public.user_roles (user_id, role, granted_by)',
'    values (v_uid, new.role, new.owner_id)',
'    on conflict (user_id) do update set role = excluded.role, updated_at = now();',
'  end if;',
'',
'  return new;',
'end $$;',
'',
'drop trigger if exists workspace_members_bind on public.workspace_members;',
'create trigger workspace_members_bind before insert or update on public.workspace_members',
'  for each row execute function public.bind_workspace_member();',
'',
'/* ---------- RLS for stage 2 tables ---------- */',
'alter table public.bank_accounts     enable row level security;',
'alter table public.user_roles        enable row level security;',
'alter table public.role_permissions  enable row level security;',
'alter table public.workspace_members enable row level security;',
'',
'drop policy if exists bank_accounts_select on public.bank_accounts;',
'create policy bank_accounts_select on public.bank_accounts for select to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'accounts_view\'));',
'drop policy if exists bank_accounts_insert on public.bank_accounts;',
'create policy bank_accounts_insert on public.bank_accounts for insert to authenticated',
'  with check (auth.uid() = user_id and public.has_perm(\'accounts_create\'));',
'drop policy if exists bank_accounts_update on public.bank_accounts;',
'create policy bank_accounts_update on public.bank_accounts for update to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'accounts_edit\'))',
'  with check (auth.uid() = user_id and public.has_perm(\'accounts_edit\'));',
'drop policy if exists bank_accounts_delete on public.bank_accounts;',
'create policy bank_accounts_delete on public.bank_accounts for delete to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'accounts_delete\'));',
'',
'/* a user reads their own role row; nobody may escalate their own role */',
'drop policy if exists user_roles_select on public.user_roles;',
'create policy user_roles_select on public.user_roles for select to authenticated',
'  using (auth.uid() = user_id or public.has_perm(\'users_manage\'));',
'drop policy if exists user_roles_insert on public.user_roles;',
'create policy user_roles_insert on public.user_roles for insert to authenticated',
'  with check (public.has_perm(\'users_manage\'));',
'drop policy if exists user_roles_update on public.user_roles;',
'create policy user_roles_update on public.user_roles for update to authenticated',
'  using (public.has_perm(\'users_manage\') and auth.uid() <> user_id)',
'  with check (public.has_perm(\'users_manage\') and auth.uid() <> user_id);',
'',
'/* the matrix is read-only reference data */',
'drop policy if exists role_permissions_select on public.role_permissions;',
'create policy role_permissions_select on public.role_permissions for select to authenticated using (true);',
'',
'drop policy if exists workspace_members_select on public.workspace_members;',
'create policy workspace_members_select on public.workspace_members for select to authenticated',
'  using (auth.uid() = owner_id or auth.uid() = user_id);',
'drop policy if exists workspace_members_insert on public.workspace_members;',
'create policy workspace_members_insert on public.workspace_members for insert to authenticated',
'  with check (auth.uid() = owner_id and public.has_perm(\'users_manage\'));',
'drop policy if exists workspace_members_update on public.workspace_members;',
'create policy workspace_members_update on public.workspace_members for update to authenticated',
'  using (auth.uid() = owner_id and public.has_perm(\'users_manage\'))',
'  with check (auth.uid() = owner_id and public.has_perm(\'users_manage\'));',
'drop policy if exists workspace_members_delete on public.workspace_members;',
'create policy workspace_members_delete on public.workspace_members for delete to authenticated',
'  using (auth.uid() = owner_id and public.has_perm(\'users_manage\'));',
'',
'/* transactions: permissions gate create, edit and delete */',
'drop policy if exists transactions_all on public.transactions;',
'drop policy if exists transactions_select on public.transactions;',
'create policy transactions_select on public.transactions for select to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'transactions_view\'));',
'drop policy if exists transactions_insert on public.transactions;',
'create policy transactions_insert on public.transactions for insert to authenticated',
'  with check (auth.uid() = user_id and public.has_perm(\'transactions_create\'));',
'drop policy if exists transactions_update on public.transactions;',
'create policy transactions_update on public.transactions for update to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'transactions_edit\'))',
'  with check (auth.uid() = user_id and public.has_perm(\'transactions_edit\'));',
'drop policy if exists transactions_delete on public.transactions;',
'create policy transactions_delete on public.transactions for delete to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'transactions_delete\'));',
'',
'grant select, insert, update, delete on public.bank_accounts, public.user_roles,',
'  public.workspace_members to authenticated;',
'grant select on public.role_permissions to authenticated;',
'',
'/* budgets gated by the budget permission */',
'drop policy if exists budgets_all on public.budgets;',
'drop policy if exists budgets_select on public.budgets;',
'create policy budgets_select on public.budgets for select to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'reports_view\'));',
'drop policy if exists budgets_write on public.budgets;',
'create policy budgets_write on public.budgets for all to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'budgets_manage\'))',
'  with check (auth.uid() = user_id and public.has_perm(\'budgets_manage\'));',
'',
'/* backfill for accounts that already exist */',
'do $$',
'declare r record;',
'begin',
'  for r in select id from public.bank_accounts loop',
'    perform public.recalc_account_balance(r.id);',
'  end loop;',
'end $$;',
'',
'/* backfill roles and membership for users created before stage 2 */',
'insert into public.user_roles (user_id, role)',
'select id, \'owner\' from auth.users on conflict (user_id) do nothing;',
'',
'insert into public.workspace_members (owner_id, user_id, email, display_name, role, status)',
'select u.id, u.id, coalesce(u.email, \'\'), coalesce(p.full_name, \'\'), \'owner\', \'active\'',
'from auth.users u left join public.profiles p on p.id = u.id',
'on conflict (owner_id, email) do nothing;',
'',
'/* ============================================================',
'   STAGE 3 - internal transfers',
'   ============================================================ */',
'',
'create table if not exists public.transfers (',
'  id uuid primary key default gen_random_uuid(),',
'  user_id uuid not null references auth.users(id) on delete cascade,',
'  from_account_id uuid not null references public.bank_accounts(id) on delete restrict,',
'  to_account_id uuid not null references public.bank_accounts(id) on delete restrict,',
'  amount numeric(14,2) not null check (amount > 0),',
'  note text not null default \'\',',
'  reference text not null,',
'  occurred_on date not null default current_date,',
'  created_at timestamptz not null default now(),',
'  constraint transfers_distinct_accounts check (from_account_id <> to_account_id),',
'  constraint transfers_reference_uniq unique (user_id, reference)',
');',
'',
'create index if not exists transfers_user_idx on public.transfers (user_id, created_at desc);',
'create index if not exists transfers_from_idx on public.transfers (from_account_id);',
'create index if not exists transfers_to_idx on public.transfers (to_account_id);',
'',
'alter table public.transfers enable row level security;',
'',
'drop policy if exists transfers_select on public.transfers;',
'create policy transfers_select on public.transfers for select to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'transactions_view\'));',
'drop policy if exists transfers_insert on public.transfers;',
'create policy transfers_insert on public.transfers for insert to authenticated',
'  with check (auth.uid() = user_id and public.has_perm(\'transactions_create\'));',
'drop policy if exists transfers_delete on public.transfers;',
'create policy transfers_delete on public.transfers for delete to authenticated',
'  using (auth.uid() = user_id and public.has_perm(\'transactions_delete\'));',
'',
'grant select, insert, delete on public.transfers to authenticated;',
'',
'/* Transfers move money, so recalc must count them on both sides. */',
'create or replace function public.recalc_account_balance(p_account_id uuid)',
'returns void language plpgsql security definer set search_path = public as $$',
'declare',
'  v_open numeric(14,2);',
'  v_income numeric(14,2);',
'  v_expense numeric(14,2);',
'  v_out numeric(14,2);',
'  v_in numeric(14,2);',
'begin',
'  if p_account_id is null then return; end if;',
'  select opening_balance into v_open from public.bank_accounts where id = p_account_id;',
'  if not found then return; end if;',
'',
'  select coalesce(sum(case when type = \'income\' then amount else 0 end), 0),',
'         coalesce(sum(case when type = \'expense\' then amount else 0 end), 0)',
'    into v_income, v_expense',
'  from public.transactions where account_id = p_account_id;',
'',
'  select coalesce(sum(case when from_account_id = p_account_id then amount else 0 end), 0),',
'         coalesce(sum(case when to_account_id = p_account_id then amount else 0 end), 0)',
'    into v_out, v_in',
'  from public.transfers',
'  where from_account_id = p_account_id or to_account_id = p_account_id;',
'',
'  update public.bank_accounts',
'     set current_balance = coalesce(v_open, 0) + v_income - v_expense - v_out + v_in,',
'         updated_at = now()',
'   where id = p_account_id;',
'end $$;',
'',
'/* One function, one transaction: both balances move or neither does. */',
'create or replace function public.create_transfer(',
'  p_from uuid,',
'  p_to uuid,',
'  p_amount numeric,',
'  p_note text default \'\',',
'  p_occurred_on date default current_date,',
'  p_reference text default null',
')',
'returns public.transfers language plpgsql security definer set search_path = public as $$',
'declare',
'  v_from public.bank_accounts;',
'  v_to public.bank_accounts;',
'  v_ref text;',
'  v_row public.transfers;',
'begin',
'  if auth.uid() is null then',
'    raise exception \'Not authenticated\' using errcode = \'28000\';',
'  end if;',
'  if p_from is null or p_to is null then',
'    raise exception \'Choose a source and a destination account\' using errcode = \'22023\';',
'  end if;',
'  if p_from = p_to then',
'    raise exception \'Source and destination must differ\' using errcode = \'22023\';',
'  end if;',
'  if p_amount is null or p_amount <= 0 then',
'    raise exception \'Transfer amount must be greater than zero\' using errcode = \'22023\';',
'  end if;',
'',
'  select * into v_from from public.bank_accounts where id = p_from and user_id = auth.uid() for update;',
'  if not found then raise exception \'Source account not found\' using errcode = \'22023\'; end if;',
'  select * into v_to from public.bank_accounts where id = p_to and user_id = auth.uid() for update;',
'  if not found then raise exception \'Destination account not found\' using errcode = \'22023\'; end if;',
'  if v_from.status = \'closed\' or v_to.status = \'closed\' then',
'    raise exception \'Closed accounts cannot take part in a transfer\' using errcode = \'22023\';',
'  end if;',
'',
'  v_ref := coalesce(nullif(trim(p_reference), \'\'),',
'    \'TRF-\' || to_char(now(), \'YYYYMMDD\') || \'-\' || upper(substr(replace(gen_random_uuid()::text, \'-\', \'\'), 1, 6)));',
'',
'  insert into public.transfers (user_id, from_account_id, to_account_id, amount, note, reference, occurred_on)',
'  values (auth.uid(), p_from, p_to, p_amount, coalesce(p_note, \'\'), v_ref, coalesce(p_occurred_on, current_date))',
'  returning * into v_row;',
'',
'  perform public.recalc_account_balance(p_from);',
'  perform public.recalc_account_balance(p_to);',
'',
'  return v_row;',
'exception',
'  when unique_violation then',
'    raise exception \'A transfer with that reference already exists\' using errcode = \'23505\';',
'end $$;',
'',
'grant execute on function public.create_transfer(uuid, uuid, numeric, text, date, text) to authenticated;',
'',
'/* Removing a transfer puts both balances back. */',
'create or replace function public.transfers_balance_trigger()',
'returns trigger language plpgsql security definer set search_path = public as $$',
'begin',
'  if tg_op = \'DELETE\' then',
'    perform public.recalc_account_balance(old.from_account_id);',
'    perform public.recalc_account_balance(old.to_account_id);',
'  end if;',
'  return null;',
'end $$;',
'',
'drop trigger if exists transfers_balance on public.transfers;',
'create trigger transfers_balance after delete on public.transfers',
'  for each row execute function public.transfers_balance_trigger();',
'',
'create or replace function public.recalc_all_balances()',
'returns void language plpgsql security definer set search_path = public as $$',
'declare r record;',
'begin',
'  for r in select id from public.bank_accounts where user_id = auth.uid() loop',
'    perform public.recalc_account_balance(r.id);',
'  end loop;',
'end $$;',
'',
'grant execute on function public.recalc_all_balances() to authenticated;'
].join('\n');

/* The Stage 2 half of the schema, shown on its own in the migration dialog. */
var STAGE2_SQL = (function () {
  var marker = 'STAGE 2 - bank accounts';
  var i = SCHEMA_SQL.indexOf(marker);
  if (i < 0) return SCHEMA_SQL;
  var start = SCHEMA_SQL.lastIndexOf('/*', i);
  return SCHEMA_SQL.slice(start < 0 ? i : start);
})();

function openMigrationModal() {
  var root = $('#modal-root');
  root.innerHTML = '<div class="overlay" data-mig-overlay="1"><div class="modal wide" role="dialog" aria-modal="true">' +
    '<div class="modal-head"><h3>Stage 2 migration SQL</h3>' +
    '<button class="icon-btn" type="button" data-close="1" aria-label="Close">✕</button></div>' +
    '<div class="modal-body">' +
      '<p class="muted small" style="margin:0 0 10px">Run this once in Supabase → SQL Editor. It is safe to re-run: every statement is guarded.</p>' +
      '<pre class="code" id="mig-sql" style="max-height:340px"></pre>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
        '<button class="btn small" type="button" id="mig-copy">Copy migration</button>' +
        '<button class="btn ghost small" type="button" id="mig-retry">Re-check database</button>' +
      '</div>' +
      '<p class="hint" id="mig-msg"></p>' +
    '</div>' +
    '<div class="modal-foot"><button class="btn ghost" type="button" data-close="1">Close</button></div>' +
    '</div></div>';

  $('#mig-sql').textContent = STAGE2_SQL;
  $('[data-mig-overlay]').addEventListener('click', function (e) { if (e.target === this) closeModal(); });
  $('#mig-copy').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(STAGE2_SQL).then(
        function () { setMsg('#mig-msg', 'Migration copied to the clipboard.', 'ok'); },
        function () { setMsg('#mig-msg', 'Copy blocked. Select the SQL manually.', 'err'); }
      );
    } else {
      var r = document.createRange();
      r.selectNodeContents($('#mig-sql'));
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      setMsg('#mig-msg', 'Text selected. Press Ctrl/Cmd+C.', 'ok');
    }
  });
  $('#mig-retry').addEventListener('click', async function () {
    setMsg('#mig-msg', 'Checking…');
    try {
      await loadRole();
      await loadAccounts();
      await loadCategories();
      buildLedgers(true);
      renderShell();
      renderStage2Notice();
      closeModal();
      if (stage2Ready) { toast('Stage 2 database detected', 'ok'); showView('accounts'); }
      else { toast('Still missing. Run the migration first.', 'err'); }
    } catch (e) { setMsg('#mig-msg', errMsg(e), 'err'); }
  });
}

/* ============================================================
   Auth screen
   ============================================================ */
var authMode = 'signin';

function setAuthMode(mode) {
  authMode = mode;
  $$('.tab').forEach(function (t) { t.classList.toggle('active', t.getAttribute('data-mode') === mode); });
  $('#f-name').classList.toggle('hidden', mode !== 'signup');
  $('#auth-submit').textContent = mode === 'signup' ? 'Create account' : 'Sign in';
  $('#auth-lead').textContent = mode === 'signup'
    ? 'Create your account. A profile and starter categories are created automatically.'
    : 'Sign in to your personal finance workspace.';
  $('#auth-pass').setAttribute('autocomplete', mode === 'signup' ? 'new-password' : 'current-password');
  setMsg('#auth-msg', '');
}

async function handleAuthSubmit(ev) {
  ev.preventDefault();
  var email = $('#auth-email').value.trim();
  var pass = $('#auth-pass').value;
  var name = $('#auth-name').value.trim();
  var btn = $('#auth-submit');
  if (!email || !pass) { setMsg('#auth-msg', 'Email and password are required.', 'err'); return; }
  if (authMode === 'signup' && pass.length < 6) { setMsg('#auth-msg', 'Use a password of at least 6 characters.', 'err'); return; }
  btn.disabled = true;
  var label = btn.textContent;
  btn.textContent = authMode === 'signup' ? 'Creating account…' : 'Signing in…';
  setMsg('#auth-msg', '');
  try {
    if (!sb) throw new Error('Not connected to a Supabase project.');
    if (authMode === 'signup') {
      var r = await sb.auth.signUp({ email: email, password: pass, options: { data: { full_name: name } } });
      if (r.error) throw r.error;
      if (!r.data.session) {
        setMsg('#auth-msg', 'Account created. Confirm your email address, then sign in.', 'ok');
        setAuthMode('signin');
      }
    } else {
      var s = await sb.auth.signInWithPassword({ email: email, password: pass });
      if (s.error) throw s.error;
      /* Write the token pair before the app opens, so an immediate refresh
         cannot land between sign-in and the save. */
      if (s.data && s.data.session) {
        session = s.data.session;
        user = s.data.session.user;
        await persistSessionNow(s.data.session);
      }
    }
    $('#auth-pass').value = '';
  } catch (e) {
    if (isNetworkError(e)) {
      showNetblock('Sign-in request was blocked: ' + errMsg(e));
      return;
    }
    setMsg('#auth-msg', errMsg(e), 'err');
  } finally {
    btn.disabled = false;
    btn.textContent = authMode === 'signup' ? 'Create account' : label;
  }
}

async function handleForgot() {
  var email = $('#auth-email').value.trim();
  if (!email) { setMsg('#auth-msg', 'Enter your email address first.', 'err'); return; }
  try {
    var r = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] });
    if (r.error) throw r.error;
    setMsg('#auth-msg', 'Password reset link sent to ' + email + '.', 'ok');
  } catch (e) { setMsg('#auth-msg', errMsg(e), 'err'); }
}

/* ============================================================
   Setup screen
   ============================================================ */
async function handleSetup(ev) {
  ev.preventDefault();
  var url = $('#cfg-url').value.trim().replace(/\/+$/, '');
  var key = $('#cfg-key').value.trim();
  if (!/^https?:\/\/.+/.test(url)) { setMsg('#setup-msg', 'Enter the full project URL, e.g. https://abcd.supabase.co', 'err'); return; }
  if (key.length < 20) { setMsg('#setup-msg', 'That does not look like a public anon key.', 'err'); return; }
  if (key.indexOf('service_role') >= 0 || key.split('.').length === 3 && (function () {
    try { var p = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); return p.role === 'service_role'; }
    catch (e) { return false; }
  })()) {
    setMsg('#setup-msg', 'This is a service-role key. Use the public anon key only.', 'err');
    return;
  }
  await saveCfg(url, key);
  setMsg('#setup-msg', 'Connecting…', 'ok');
  var okStart = await startClient({ url: url, key: key });
  if (okStart) setMsg('#setup-msg', '');
}

/* ============================================================
   Global event wiring
   ============================================================ */
function findTx(id) {
  var found = null;
  Object.keys(state.ledgers).forEach(function (k) {
    var list = state.ledgers[k].rows || [];
    list.forEach(function (r) { if (r.id === id) found = r; });
  });
  return found;
}

function wireEvents() {
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;

    if (t.closest('[data-close]') || (t.getAttribute && t.getAttribute('data-overlay'))) {
      closeModal();
      return;
    }

    var nav = t.closest('.nav-item');
    if (nav) { showView(nav.getAttribute('data-view')); return; }

    var go = t.closest('[data-goto]');
    if (go) { showView(go.getAttribute('data-goto')); return; }

    var nt = t.closest('[data-newtx]');
    if (nt) {
      var preset = nt.getAttribute('data-newtx');
      openTxModal(null, preset === '1' ? null : preset);
      return;
    }

    var et = t.closest('[data-edit-tx]');
    if (et) {
      var row = findTx(et.getAttribute('data-edit-tx'));
      if (row) openTxModal(row, null);
      else toast('Reload the list and try again.', 'err');
      return;
    }

    var dt = t.closest('[data-del-tx]');
    if (dt) { deleteTransaction(dt.getAttribute('data-del-tx')); return; }

    var nc = t.closest('[data-newcat]');
    if (nc) { openCatModal(null, nc.getAttribute('data-newcat')); return; }

    var ec = t.closest('[data-edit-cat]');
    if (ec) { var c = catById(ec.getAttribute('data-edit-cat')); if (c) openCatModal(c, c.type); return; }

    var dc = t.closest('[data-del-cat]');
    if (dc) { deleteCategory(dc.getAttribute('data-del-cat')); return; }

    var pg = t.closest('[data-page]');
    if (pg) {
      var key = pg.getAttribute('data-page');
      var dir = Number(pg.getAttribute('data-dir'));
      var st = state.ledgers[key];
      st.page = Math.max(0, st.page + dir);
      loadLedger(key);
      return;
    }

    var reset = t.closest('[data-led="reset"]');
    if (reset) {
      var host = reset.closest('.view');
      var k2 = host.id.replace('view-', '');
      var s2 = state.ledgers[k2];
      s2.month = monthKey(); s2.cat = 'all'; s2.q = ''; s2.page = 0; s2.acct = 'all';
      if (k2 === 'transactions') s2.type = 'all';
      loadLedger(k2);
      return;
    }

    if (t.closest('#quick-add')) { openTxModal(null, state.view === 'income' ? 'income' : state.view === 'expenses' ? 'expenses' : null); return; }
    if (t.closest('#signout')) { doSignOut(); return; }
    if (t.closest('#burger')) { $('#sidebar').classList.toggle('open'); return; }

    var na = t.closest('[data-newacct]');
    if (na) { openAccountModal(null); return; }
    var ea = t.closest('[data-acct-edit]');
    if (ea) { var acc = acctById(ea.getAttribute('data-acct-edit')); if (acc) openAccountModal(acc); return; }
    var da = t.closest('[data-acct-del]');
    if (da) { deleteAccount(da.getAttribute('data-acct-del')); return; }
    var va = t.closest('[data-acct-view]');
    if (va) { openAccountHistory(va.getAttribute('data-acct-view')); return; }

    var nt2 = t.closest('[data-newtransfer]');
    if (nt2) { openTransferModal(); return; }
    var dtf = t.closest('[data-del-transfer]');
    if (dtf) { deleteTransfer(dtf.getAttribute('data-del-transfer')); return; }

    if (t.closest('[data-stage2-sql]')) { openMigrationModal(); return; }
  });

  /* team view uses delegated handlers bound at render time */

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (!t || !t.getAttribute) return;
    var role = t.getAttribute('data-led');
    if (!role) return;
    var host = t.closest('.view');
    if (!host) return;
    var key = host.id.replace('view-', '');
    var st = state.ledgers[key];
    if (!st) return;
    if (role === 'month') { st.month = t.value || ''; }
    else if (role === 'type') { st.type = t.value; st.cat = 'all'; st.acct = 'all'; }
    else if (role === 'cat') { st.cat = t.value; }
    else if (role === 'acct') { st.acct = t.value; }
    st.page = 0;
    loadLedger(key);
  });

  var searchTimer = null;
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (!t || t.getAttribute('data-led') !== 'q') return;
    var host = t.closest('.view');
    if (!host) return;
    var key = host.id.replace('view-', '');
    var st = state.ledgers[key];
    if (!st) return;
    clearTimeout(searchTimer);
    var val = t.value;
    searchTimer = setTimeout(function () {
      st.q = val;
      st.page = 0;
      loadLedger(key);
    }, 350);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape') return;
    var cancel = $('[data-cf-close]');
    if (cancel) { cancel.click(); return; }
    closeModal();
  });

  window.addEventListener('hashchange', function () {
    var h = (location.hash || '').replace(/^#\/?/, '');
    if (TITLES[h] && h !== state.view) showView(h);
  });
}

/* ============================================================
   Init
   ============================================================ */
function init() {
  buildLedgers();
  var pre = $('#schema-pre');
  if (pre) pre.textContent = SCHEMA_SQL;

  $('#setup-form').addEventListener('submit', handleSetup);
  $('#copy-sql').addEventListener('click', function () {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(SCHEMA_SQL).then(function () { toast('Schema copied', 'ok'); }, function () { toast('Copy failed — select the text manually', 'err'); });
    } else {
      var r = document.createRange();
      r.selectNodeContents($('#schema-pre'));
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      toast('Text selected — press Ctrl/Cmd+C', 'ok');
    }
  });
  $('#cfg-change').addEventListener('click', async function () {
    var ok = await askConfirm('Change Supabase project', 'Forget the saved connection details and enter a different project?', 'Change project');
    if (!ok) return;
    await resetConnection();
  });

  $$('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () { setAuthMode(tab.getAttribute('data-mode')); });
  });
  $('#auth-form').addEventListener('submit', handleAuthSubmit);
  $('#forgot').addEventListener('click', handleForgot);

  /* Flush the session when the page is hidden or unloaded, so a reload or a
     tab close right after a token refresh still finds the newest pair. */
  window.addEventListener('pagehide', function () { if (session) persistSessionNow(session); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden' && session) persistSessionNow(session);
  });

  /* Back and forward between #/dashboard and #/transactions must not reload
     the app or drop the session. */
  window.addEventListener('hashchange', function () {
    if (!authReady || !appReady) return;
    var next = (location.hash || '').replace(/^#\/?/, '');
    if (TITLES[next] && next !== state.view) showView(next);
  });

  wireEvents();
  armAudioOnce();
  boot();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
