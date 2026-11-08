'use strict';

/* ==========================================================================
   PINCH Finance - Standard Edition - supabase.js
   --------------------------------------------------------------------------
   Flat repository layout: this file sits in the repository root next to
   index.html. No js/ folder, no src/ folder.

   This file owns everything that talks to Supabase:
     - the project connection (URL + publishable key)
     - the persistent auth session, so a refresh never logs you out
     - the data access helpers (profiles, categories, accounts, ledgers)
     - Overall Money, the combined balance of every eligible account

   It is loaded before script.js. Nothing here runs on load; the client is
   created by boot(), which script.js calls from its init().

   Created and owned by James Carlo H. Cadayona.
   Developed under PINCH Software.
   ========================================================================== */

/* Project connection. Only the public publishable (anon) key belongs here.
   The secret / service-role key must never be shipped to a browser. */
var CONFIG = {
  url: 'https://zfhosceosdowhbilnoao.supabase.co',
  anonKey: 'sb_publishable_xLBNR_CmkqklT8dy12AfAQ_Ti-PUNRB'
};

var sb = null;
var session = null;
var user = null;
var profile = null;
var cats = [];
var accounts = [];
var members = [];
var appReady = false;
var acctSaving = false;

/* ---------- connection settings ----------
   Only the project URL and the public anon key are kept client side.
   No financial record is ever stored outside Supabase. */
var STORE = (window.jetdraftArtifact && window.jetdraftArtifact.storage) || null;

function storeGet(key) {
  if (!STORE) return Promise.resolve(null);
  return STORE.get(key, { shared: false }).then(function (v) { return v == null ? null : v; }).catch(function () { return null; });
}
function storeSet(key, value) {
  if (!STORE) return Promise.resolve();
  return STORE.set(key, value, { shared: false }).catch(function () { });
}
function storeDel(key) {
  if (!STORE) return Promise.resolve();
  return STORE.delete(key, { shared: false }).catch(function () { });
}

async function readCfg() {
  var url = (CONFIG.url || '').trim(), key = (CONFIG.anonKey || '').trim();
  if (!url || !key || url.indexOf('YOUR_') === 0) {
    var saved = await storeGet(CFG_KEY);
    if (saved && typeof saved === 'object' && saved.value !== undefined) saved = saved.value;
    if (typeof saved === 'string') { try { saved = JSON.parse(saved); } catch (e) { saved = null; } }
    if (saved && saved.url && saved.key) { url = saved.url; key = saved.key; }
  }
  return { url: url, key: key };
}
function saveCfg(url, key) { return storeSet(CFG_KEY, { url: url, key: key }); }
function clearCfg() { return storeDel(CFG_KEY); }

function loadSupabaseLib() {
  if (window.supabase && window.supabase.createClient) return Promise.resolve();
  var sources = [
    'https://unpkg.com/@supabase/supabase-js@2.45.4/dist/umd/supabase.js',
    'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js'
  ];
  return new Promise(function (resolve, reject) {
    var i = 0;
    (function next() {
      if (window.supabase && window.supabase.createClient) return resolve();
      if (i >= sources.length) return reject(new Error('Could not load the Supabase client library. Check the network connection.'));
      var s = document.createElement('script');
      s.src = sources[i++];
      s.onload = function () { (window.supabase && window.supabase.createClient) ? resolve() : next(); };
      s.onerror = next;
      document.head.appendChild(s);
    })();
  });
}

/* ============================================================
   Persistent session storage
   ------------------------------------------------------------
   Supabase issues a short-lived access token plus a long-lived refresh
   token. Keeping that pair across restarts is what makes a login persist;
   the client then refreshes the access token in the background on its own.
   Persistence is unconditional - there is no "remember me" flag anywhere.

   The artifact key-value store is asynchronous. If the Supabase client read
   it lazily, getSession() would race the read and conclude "no session" on
   every refresh, which is exactly the bug that bounced users back to the
   login page. So the whole auth namespace is hydrated into memory BEFORE
   the client is created. After that the adapter answers synchronously and
   writes through to the store in the background.

   Financial records never go here; they stay in Supabase and every request
   still carries the user's JWT, so RLS applies exactly as before.
   ============================================================ */
var AUTH_KEY = 'pinch.auth';
var authMemory = {};

/* True only while the stored session is being read at startup. The login
   screen must not appear during this window. */
var authRestoring = true;
/* True once startup has decided between dashboard and login. */
var authReady = false;

function readMemory(k) {
  return Object.prototype.hasOwnProperty.call(authMemory, k) ? authMemory[k] : null;
}

/* Values are wrapped as { v: "<json string>" }. The wrapper keeps the session
   intact whatever the store does with primitives, and makes "missing" distinct
   from "empty". */
function unwrap(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'object' && typeof raw.v === 'string') return raw.v;
  return null;
}

/* Load every persisted auth key into memory once, before createClient(). */
async function hydrateAuthMemory() {
  if (!STORE) return;

  try {
    var v = unwrap(await STORE.get(AUTH_KEY, { shared: false }));
    if (v != null) authMemory[AUTH_KEY] = v;
  } catch (e) { /* no stored session */ }

  if (typeof STORE.list !== 'function') return;
  var extra = [];
  try {
    var keys = await STORE.list({ shared: false });
    (keys || []).forEach(function (k) {
      k = String(k);
      if (k.indexOf(AUTH_KEY) === 0 && k !== AUTH_KEY) extra.push(k);
    });
  } catch (e) {
    return;
  }
  await Promise.all(extra.map(async function (k) {
    try {
      var raw = unwrap(await STORE.get(k, { shared: false }));
      if (raw != null) authMemory[k] = raw;
    } catch (e) { /* skip this key */ }
  }));
}

/* Force the current session into the store and wait for the write to land.
   Called right after sign-in and when the page is about to go away, so a
   refresh can never outrun the save. */
async function persistSessionNow(s) {
  if (!s) return;
  var raw;
  try { raw = JSON.stringify(s); } catch (e) { return; }
  authMemory[AUTH_KEY] = raw;
  if (!STORE) return;
  try { await STORE.set(AUTH_KEY, { v: raw }, { shared: false }); } catch (e) { /* ignore */ }
}

/* Synchronous reads, write-through writes. supabase-js passes the full
   storageKey (and its companions), so no extra prefixing is applied here. */
function makeAuthStorage() {
  return {
    getItem: function (k) { return readMemory(k); },
    setItem: function (k, v) {
      authMemory[k] = v;
      if (!STORE) return;
      try { STORE.set(k, { v: v }, { shared: false }); } catch (e) { /* ignore */ }
    },
    removeItem: function (k) {
      delete authMemory[k];
      if (!STORE) return;
      try { STORE.delete(k, { shared: false }); } catch (e) { /* ignore */ }
    }
  };
}

/* Wipe every key the session could have been written under. */
function purgeSessionStorage() {
  var known = Object.keys(authMemory);
  authMemory = {};
  if (!STORE) return;
  known.forEach(function (k) {
    try { STORE.delete(k, { shared: false }); } catch (e) { /* ignore */ }
  });
  /* Belt and braces: anything left under the auth prefix. */
  if (typeof STORE.list !== 'function') return;
  try {
    var pending = STORE.list({ shared: false });
    if (pending && pending.then) {
      pending.then(function (keys) {
        (keys || []).forEach(function (key) {
          if (String(key).indexOf(AUTH_KEY) === 0) {
            try { STORE.delete(key, { shared: false }); } catch (e) { /* ignore */ }
          }
        });
      }).catch(function () { });
    }
  } catch (e) { /* ignore */ }
}

/* ---------- data access ---------- */
function requireSession() {
  if (!session || !user) throw new Error('Your session expired. Sign in again.');
}

async function loadProfile() {
  requireSession();
  var res = await sb.from('profiles').select('id,full_name,currency,monthly_budget,created_at').eq('id', user.id).maybeSingle();
  if (res.error) throw res.error;
  if (!res.data) {
    var meta = (user.user_metadata && user.user_metadata.full_name) || '';
    var ins = await sb.from('profiles').upsert({ id: user.id, full_name: meta, currency: 'USD' }).select().maybeSingle();
    if (ins.error) throw ins.error;
    profile = ins.data || { id: user.id, full_name: meta, currency: 'USD' };
  } else {
    profile = res.data;
  }
  return profile;
}

async function loadCategories() {
  requireSession();
  var res = await sb.from('categories').select('id,name,type,color,created_at').order('name', { ascending: true });
  if (res.error) throw res.error;
  cats = res.data || [];
  return cats;
}

/* ---------- bank accounts ---------- */
async function loadAccounts(force) {
  if (!can('accounts_view')) { accounts = []; return accounts; }
  try {
    var res = await sb.from('bank_accounts')
      .select('id,name,institution,account_type,account_number,opening_balance,current_balance,currency,status,created_at')
      .order('created_at', { ascending: true });
    if (res.error) throw res.error;
    accounts = res.data || [];
  } catch (e) {
    if (!isMissingTable(e)) throw e;
    accounts = [];
  }
  return accounts;
}
function acctById(id) {
  for (var i = 0; i < accounts.length; i++) if (accounts[i].id === id) return accounts[i];
  return null;
}
function acctTypeKey(t) {
  return String(t || 'other').toLowerCase().replace(/[^a-z]/g, '');
}
function acctTypeLabel(t) {
  var map = { savings: 'Savings', checking: 'Checking', cash: 'Cash', e_wallet: 'E-wallet', credit_card: 'Credit card', other: 'Other' };
  return map[t] || 'Other';
}
function maskAccount(num) {
  var s = String(num || '').replace(/\s+/g, '');
  if (!s) return '—';
  if (s.length <= 4) return '•••• ' + s.slice(-2);
  return '•••• ' + s.slice(-4);
}
function activeAccounts() { return accounts.filter(function (a) { return a.status !== 'closed'; }); }

/* ------------------------------------------------------------------
   Overall Money
   ------------------------------------------------------------------
   The combined balance of every eligible account the signed-in user owns.

   The source of truth is bank_accounts.current_balance for each account,
   never income minus expenses. Postgres keeps that column correct: every
   transaction insert, update or delete and every transfer recalculates the
   affected accounts, so summing the column cannot drift from the records.

   Rules applied here:
     - every account row in `accounts` is included, whatever its type
     - closed (archived) accounts are skipped: their money has already been
       moved out, so counting them would double count
     - each account id is counted once, so a duplicated row cannot inflate
       the total
     - deleted accounts are absent from the table and therefore absent here
     - a transfer between two of the user's own accounts moves value from one
       row to another and leaves the sum unchanged
   ------------------------------------------------------------------ */
function overallMoney() {
  var seen = {}, total = 0, counted = 0, closed = 0, byCurrency = {};

  (accounts || []).forEach(function (a) {
    if (!a || !a.id) return;
    if (seen[a.id]) return;              /* no duplicate counting */
    seen[a.id] = true;

    if (a.status === 'closed') { closed++; return; }

    total += num(a.current_balance);
    counted++;
    var c = a.currency || (profile && profile.currency) || 'USD';
    byCurrency[c] = (byCurrency[c] || 0) + 1;
  });

  var currencies = Object.keys(byCurrency);
  return {
    total: total,
    counted: counted,
    closed: closed,
    currencies: currencies,
    mixedCurrency: currencies.length > 1
  };
}

/* ---------- role + permissions ---------- */
var stage2Ready = true;

function isMissingTable(e) {
  if (!e) return false;
  /* PostgREST reports PGRST205 for an unknown table and 42P01 for an unknown
     column; both put the useful text in message, not in code. */
  var code = String(e.code || '');
  var text = code + ' ' + String(e.message || '') + ' ' + String(e.details || '') + ' ' + String(e.hint || '');
  return code === 'PGRST205' || code === '42P01' || code === 'PGRST202' ||
    /could not find the table|could not find the function|does not exist|schema cache/i.test(text);
}

async function loadRole() {
  me.id = user.id;
  try {
    var res = await sb.from('user_roles').select('role').eq('user_id', user.id).maybeSingle();
    if (res.error) throw res.error;
    var role = res.data && res.data.role ? res.data.role : 'owner';
    applyRole(ROLES.indexOf(role) >= 0 ? role : 'viewer');
  } catch (e) {
    if (isMissingTable(e)) {
      /* Stage 2 SQL not applied yet: fall back to full personal access. */
      stage2Ready = false;
      applyRole('owner');
      return me.role;
    }
    throw e;
  }
  return me.role;
}

/* The Standard Edition is single-user per account: there is no team roster,
   so no member list is loaded or displayed. */
function catById(id) {
  for (var i = 0; i < cats.length; i++) if (cats[i].id === id) return cats[i];
  return null;
}
function catColor(c) {
  if (c && c.color) return c.color;
  return c ? PALETTE[Math.abs(c.name.charCodeAt(0)) % PALETTE.length] : '#94A3B8';
}
function catName(id) { var c = catById(id); return c ? c.name : 'Uncategorised'; }

/* Stage 1 projects have no account_id column yet; the select adapts. */
function txCols() {
  return stage2Ready
    ? 'id,type,amount,occurred_on,category_id,account_id,description'
    : 'id,type,amount,occurred_on,category_id,description';
}

async function fetchRange(from, to, type) {
  requireSession();
  var rows = [], offset = 0, size = 1000, guard = 0;
  while (guard++ < 25) {
    var q = sb.from('transactions').select(txCols())
      .gte('occurred_on', from).lte('occurred_on', to);
    if (type && type !== 'all') q = q.eq('type', type);
    q = q.order('occurred_on', { ascending: true }).range(offset, offset + size - 1);
    var res = await q;
    if (res.error) throw res.error;
    var data = res.data || [];
    rows = rows.concat(data);
    if (data.length < size) break;
    offset += size;
  }
  return rows;
}

function totals(rows) {
  var inc = 0, exp = 0;
  (rows || []).forEach(function (r) { if (r.type === 'income') inc += num(r.amount); else exp += num(r.amount); });
  return { income: inc, expense: exp, net: inc - exp };
}

/* ---------- boot ----------
   Startup order matters. Nothing may show the login screen until the stored
   session has been read and validated, otherwise every refresh flashes the
   login page and looks like a logout. */
async function boot() {
  show('boot');
  var cfg = await readCfg();
  if (!cfg.url || !cfg.key) {
    authRestoring = false;
    authReady = true;
    show('setup');
    return;
  }
  await startClient(cfg);
}

async function startClient(cfg) {
  show('boot');
  authRestoring = true;
  authReady = false;

  try {
    await loadSupabaseLib();
  } catch (e) {
    authRestoring = false;
    showNetblock('Could not load @supabase/supabase-js from any CDN.\n\n' + errMsg(e) +
      '\n\nIn a normal browser this means the page has no outbound network access.');
    return false;
  }

  /* Read the persisted token pair into memory BEFORE the client exists, so its
     first getSession() finds it instead of racing an async store read. */
  try { await hydrateAuthMemory(); } catch (e) { /* start with an empty store */ }

  try {
    sb = window.supabase.createClient(cfg.url, cfg.key, {
      auth: {
        /* Always on: no "remember me" branch exists in this app. */
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: AUTH_KEY,
        storage: makeAuthStorage(),
        flowType: 'pkce'
      }
    });
  } catch (e) {
    authRestoring = false;
    show('setup');
    setMsg('#setup-msg', 'Invalid project configuration: ' + errMsg(e), 'err');
    return false;
  }

  /* Subscribe before reading the session so a refresh that lands during
     startup is not missed. */
  sb.auth.onAuthStateChange(function (evt, s) {
    session = s || null;
    user = s ? s.user : null;

    /* Still restoring: let startup finish and decide. Do not redirect. */
    if (authRestoring) return;

    if (evt === 'SIGNED_OUT') {
      /* Only a real sign-out, an expired refresh token or a revoked session
         reaches this branch. */
      teardown();
      show('auth');
      return;
    }

    if (!s) return;

    /* A background refresh is not a new login: keep the current view. */
    if (evt === 'TOKEN_REFRESHED') return;

    /* SIGNED_IN / INITIAL_SESSION / USER_UPDATED while the app is not up yet. */
    if (!appReady) setTimeout(function () { enterApp(); }, 0);
  });

  var restored = null;
  try {
    var got = await sb.auth.getSession();
    restored = got && got.data ? got.data.session : null;
  } catch (e) {
    if (isNetworkError(e)) {
      authRestoring = false;
      showNetblock('Auth request failed: ' + errMsg(e) + '\nTarget: ' + cfg.url);
      return false;
    }
    restored = null;
  }

  /* A stored session can be structurally present but no longer valid. Ask the
     auth server before trusting it, and drop it only when the server actually
     rejects it - never on a network failure, or a flaky connection would log
     the user out. */
  if (restored) {
    try {
      var chk = await sb.auth.getUser();
      if (chk && chk.error) {
        var why = String((chk.error && chk.error.message) || '').toLowerCase();
        var bad = why.indexOf('invalid') >= 0 || why.indexOf('expired') >= 0 ||
                  why.indexOf('revoked') >= 0 || why.indexOf('not found') >= 0 ||
                  why.indexOf('jwt') >= 0 || why.indexOf('refresh') >= 0;
        if (bad) { purgeSessionStorage(); restored = null; }
      }
    } catch (e) { /* offline: keep the stored session */ }
  }

  /* Nothing stored: go to the login screen. A stored but stale access token is
     fine - the client refreshes it and emits TOKEN_REFRESHED. */
  authRestoring = false;
  authReady = true;
  session = restored;
  user = restored ? restored.user : null;

  if (restored) {
    await enterApp();
  } else {
    show('auth');
  }
  return true;
}

function teardown() {
  appReady = false;
  user = null; session = null; profile = null; cats = []; accounts = []; members = [];
  $('#modal-root').innerHTML = '';
  show('auth');
}
