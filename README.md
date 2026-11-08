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
