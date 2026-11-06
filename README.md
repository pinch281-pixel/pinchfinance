# PINCH Finance - Standard Edition

| | |
| --- | --- |
| **Product** | PINCH Finance |
| **Edition** | Standard Edition |
| **Version** | Beta 2 (v0.4.1) |
| **Developer** | PINCH Software |

Personal and small-team finance on Supabase: bank accounts, income, expenses,
internal transfers, budgets and reports.

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
| `script.js` | Interface: helpers, roles and permissions, router, views, modals, sound effects. |
| `supabase.js` | Everything that talks to Supabase: connection, persistent auth session, data access. |
| `*.WAV` | The nine sound cues, referenced by bare filename. |

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

- **Bank accounts** - create, edit, delete; opening balance, live balance, per-account transaction history
- **Income and expenses** - account, category, amount, date, description; edit and delete
- **Internal transfers** - between your own accounts, with reference number and notes, posted atomically
- **Categories and budgets** - monthly limits per expense category
- **Reports** - monthly and yearly summaries, category breakdown, CSV export
- **Team and roles** - owner, administrator, editor, viewer; enforced in the UI and again by RLS
- **Sound effects** - nine cues, played only after a successful action

Balances are computed in Postgres, not in the browser. Every transaction and
transfer triggers a recalculation, so the numbers cannot drift from the records.

---

## Overall Money

The dashboard shows **Overall Money**: one figure for everything you own across
all accounts.

```
Overall Money = balance of account 1
              + balance of account 2
              + balance of account 3
              + every remaining account balance
```

It is the sum of `bank_accounts.current_balance`, **not** income minus expenses.
The two are different numbers, and only one of them is right:

| Figure | Example | Why |
| --- | --- | --- |
| Income minus expenses | -345.00 | Ignores opening balances, and treats a transfer as spending |
| Sum of account balances | 9,255.00 | Matches the account cards, because it is the same data |

Rules the calculation follows:

- Every account you own is included, whatever its type - savings, checking,
  cash, e-wallet, credit card.
- Accounts marked **closed** are excluded. Their money has already been moved
  out, so counting them would double count.
- Each account id is counted once, so a duplicated row cannot inflate the total.
- Deleted accounts are gone from the table, so they are gone from the total.
- A transfer between two of your own accounts moves value from one row to
  another and leaves the sum unchanged. Transfers are never income or expenses.
- The figure is recalculated every time the dashboard loads, after every
  transaction, transfer, account creation, edit or delete.

The helper is `overallMoney()` in `supabase.js`. The dashboard and the Bank
accounts page both call it, so the two screens can never disagree.

---

## Roles

| Capability | Owner | Administrator | Editor | Viewer |
| --- | :-: | :-: | :-: | :-: |
| View dashboard, transactions, accounts, reports | yes | yes | yes | yes |
| Create and edit transactions | yes | yes | yes | no |
| Delete transactions | yes | yes | no | no |
| Create and edit accounts | yes | yes | yes | no |
| Delete accounts | yes | yes | no | no |
| Manage budgets | yes | yes | no | no |
| Manage users and roles | yes | yes | no | no |

The interface hides what a role cannot do, and Postgres refuses it anyway.
Hiding a button is convenience; the RLS policy is the actual control.

---

## Security notes

- Every table has row level security enabled and policies scoped to `auth.uid()`.
- The browser never holds a service-role key.
- Only the session token pair is stored client side, in the app's own key-value
  store. No financial record is ever cached there.
- Account numbers are masked to the last four digits in the interface.

---

## Sound effects

| File | Cue | When it plays |
| --- | --- | --- |
| `LAUNCH.WAV` | appLaunch, signIn | App opens, sign-in succeeds |
| `CASHPLS.WAV` | incomeSaved | Income recorded |
| `CASHMIN.WAV` | expenseSaved | Expense recorded |
| `CALCULAT.WAV` | transferPosted | Transfer posted |
| `MOVEFORW.WAV` | transferConfirmed | Transfer confirmed |
| `MOVEBACK.WAV` | transactionDeleted, accountDeleted, transferDeleted | Record deleted |
| `CONGRATS.WAV` | accountCreated | Account created |
| `SMARFILL.WAV` | budgetSaved | Budget saved |
| `ROLLOVER.WAV` | periodChanged | Reporting period changed |

Sounds play only after the database confirms the write. Audio is unlocked on
the first click, as browsers require, and each cue stops its own previous voice
so nothing overlaps. A missing WAV file disables that cue silently - it never
breaks a database operation.

---

## Browser support

Current Chrome, Edge, Firefox and Safari. Requires JavaScript and `fetch`.
Session persistence needs the app's key-value store, which is present when the
app is served normally over http or https.

---

## Troubleshooting

**Stuck on the connection screen** - `CONFIG` is empty and nothing was saved.
Fill in the URL and publishable key, or use the on-screen form.

**"Database schema missing"** - the migrations have not run, or ran out of
order. Run stage 2, then stage 3.

**Signed out on every refresh** - the browser is blocking the app's key-value
store, usually private mode with storage disabled. Serve the app over `http://`
or `https://` rather than `file://`.

**Transfers tab says the tables are missing** - `pinch-stage3-migration.sql`
has not been applied.

**No sound** - the first click unlocks audio. If nothing plays after that, check
that the WAV filenames match exactly, including uppercase, and sit beside
`index.html`.

---

## Version

PINCH Finance - Standard Edition, Beta 2 (v0.4.1). The sidebar shows the edition
and running version, so you can confirm which build the browser actually loaded.

| | |
| --- | --- |
| Product | PINCH Finance |
| Edition | Standard Edition |
| Version | Beta 2 (v0.4.1) |
| Developer | PINCH Software |
