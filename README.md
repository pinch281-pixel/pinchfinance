# PINCH Finance - Standard Edition

| | |
| --- | --- |
| **Product** | PINCH Finance |
| **Edition** | Standard Edition |
| **Version** | Beta 2 (v0.4.1) |
| **Software owner and creator** | James Carlo H. Cadayona |
| **Software developer / brand** | PINCH Software |

> **Created and owned by James Carlo H. Cadayona**
> **Developed under PINCH Software.**

Personal finance on Supabase: bank accounts, income, expenses, internal
transfers, budgets and reports.

Live data lives in Postgres with row level security. There is no mock database
and no local copy of your financial records.

> **Edition note.** This repository is the Standard Edition. PINCH Finance will
> also ship as a Business Edition and a Professional Edition; both are planned
> and not part of this codebase. There is no edition switcher and no Business or
> Professional code here.

---

## Repository layout

This repository is **flat on purpose**. Every file sits in the root so it can be
uploaded straight through the GitHub website, with no folder creation step.

```
PINCH-Finance/
├── README.md
├── USER_GUIDE.md
├── index.html
├── style.css
├── script.js
├── supabase.js
├── CALCULAT.WAV
├── CASHMIN.WAV
├── CASHPLS.WAV
├── CONGRATS.WAV
├── LAUNCH.WAV
├── SMARFILL.WAV
├── ROLLOVER.WAV
├── MOVEFORW.WAV
└── MOVEBACK.WAV
```

There is no `assets/`, `src/`, `css/` or `js/` folder. All references are
relative to the root, so `index.html` loads `style.css`, `script.js`,
`supabase.js` and the WAV files from the same directory.

### What each file does

| File | Purpose |
| --- | --- |
| `index.html` | Page markup only. Links the stylesheet and both scripts. |
| `style.css` | All styling. Single stylesheet, no imports. |
| `script.js` | Interface: helpers, roles, router, every view (including the account ledger), modals, sound effects. |
| `supabase.js` | Everything that talks to Supabase: connection, persistent auth session, data access, Overall Money. |
| `*.WAV` | The nine sound cues, referenced by bare filename. |

Typography pairs two Google Fonts: **Poppins** for display (brand, headings,
figures, KPI labels) and **Inter** for working text (body copy, tables, forms,
buttons). Both load from `fonts.googleapis.com` in `index.html`.

Load order in `index.html` matters and is already correct:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
<script src="supabase.js"></script>
<script src="script.js"></script>
```

`supabase.js` defines the client, the session and the data helpers. `script.js`
runs the interface and calls `boot()` from its `init()`. Reversing them breaks
startup.

---

## Getting started

### 1. Create the database

Open your Supabase project, go to **SQL Editor**, and run the two migration
files in order. Each one is safe to re-run.

1. `pinch-stage2-migration.sql` - accounts, roles, permissions, account_id column
2. `pinch-stage3-migration.sql` - transfers table, atomic transfer function, transfer-aware balances

Run stage 2 before stage 3. Stage 3 redefines `recalc_account_balance` so that
transfers count on both sides; that redefinition is what keeps balances correct.

### 2. Add your connection details

`supabase.js` ships with the project URL and publishable key already set:

```js
var CONFIG = {
  url: 'https://<your-project>.supabase.co',
  anonKey: 'sb_publishable_...'
};
```

Use only the **publishable / anon** key. A secret or service-role key in a
browser hands every visitor full database access.

You can also leave `CONFIG` blank and enter the details on the app's connection
screen instead.

### 3. Publish

Push all files to the repository root and enable **GitHub Pages**
(Settings -> Pages -> Deploy from branch -> `main` / root). The app is plain
static files, so any static host works: Netlify, Vercel, Cloudflare Pages, or a
local folder.

Opening `index.html` directly from disk with `file://` mostly works, but the
sound files may be blocked by the browser's local-file policy. Serve over
`http://` for a faithful test:

```
python3 -m http.server 8000
```

---

## Features

- **Bank accounts** - create, edit, delete; opening balance, live balance, and a per-account ledger (**View account history**) that lists that account's own income and expenses and lets you add, edit or delete transactions from inside it
- **Income and expenses** - account, category, amount, date, description; edit and delete
- **Internal transfers** - between your own accounts, with reference number and notes, posted atomically
- **Categories and budgets** - monthly limits per expense category
- **Reports** - monthly and yearly summaries, category breakdown, CSV export
- **Overall Money** - the combined balance of every eligible account, on the dashboard
- **Sound effects** - nine cues, played only after a successful action

Balances are computed in Postgres, not in the browser. Every transaction and
transfer triggers a recalculation, so the numbers cannot drift from the records.
