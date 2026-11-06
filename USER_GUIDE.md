# PINCH Finance - Standard Edition - User Guide

| | |
| --- | --- |
| **Product** | PINCH Finance |
| **Edition** | Standard Edition |
| **Version** | Beta 2 (v0.4.1) |
| **Developer** | PINCH Software |

This guide covers day-to-day use. For installation, see `README.md`.

All files live in one flat folder: `index.html`, `style.css`, `script.js`,
`supabase.js` and the nine WAV files. Nothing needs a subfolder.

You are using the **Standard Edition**. Business Edition and Professional
Edition are planned for the future and are not part of this app.

---

## 1. Signing in

Open the app. You will see either the dashboard or the sign-in screen.

**First time.** Choose **Create account**, enter your name, email and a password
of at least six characters, then submit. If your project requires email
confirmation, check your inbox before signing in.

**Returning.** Enter your email and password.

You stay signed in on that device. Refresh the page, close the tab, reopen the
browser - you land back on the page you were on. There is no "remember me"
checkbox because persistence is always on.

To sign out, use **Sign out** in the sidebar or on the Profile page. Signing out
clears the session on that device only.

**Forgot your password?** Enter your email, click **Forgot password?**, and
follow the link Supabase emails you.

---

## 2. Reading the dashboard

### Overall money

The first thing on the dashboard is **Overall money**: one large figure for
everything you own, added up across all your accounts.

```
Overall money = account 1 + account 2 + account 3 + all remaining accounts
```

It is the sum of the actual balances, not income minus expenses. That matters:
income minus expenses ignores the money each account started with, and it treats
a transfer between your own accounts as if you had spent it.

Under the figure you see how many accounts were combined, and small pills naming
each account with its balance. If any account is closed, the line says how many
were excluded.

Overall money changes when:

- you record income - it goes up by the amount
- you record an expense - it goes down by the amount
- you add an account with an opening balance - it goes up by that balance
- you delete an account - the total drops by that account's balance
- you close an account - the total drops by that balance

Overall money does **not** change when you transfer money between two of your own
accounts. The money has only moved, so the combined total stays the same.

### The rest of the dashboard

Four figures below it:

- **Income this month** - with the change against last month
- **Expenses this month** - with the change against last month
- **Net this month** - what is left, plus your savings rate
- **Lifetime net** - all income minus all expenses, ever

Then your accounts with live balances, a six-month cash flow chart, this month's
spending by category, recent activity, and budget progress.

Every figure is calculated from your records. Nothing is typed in twice.

---

## 3. Bank accounts

**Bank accounts** in the sidebar. This is where money lives: savings, checking,
cash, e-wallets, credit cards.

### Adding an account

1. Click **+ Add new account** at the top of the page. The same button appears on
   the dashboard's Accounts card.
2. Fill in:
   - **Account name** - required, e.g. "Everyday checking"
   - **Bank or institution** - optional
   - **Account type** - savings, checking, cash, e-wallet, credit card, other
   - **Account number** - optional; only the last four digits are ever shown
   - **Opening balance** - what the account holds today
   - **Currency**
   - **Status** - active, inactive or closed
3. Click **Create account**.

The account appears immediately with a balance equal to its opening balance.

### Editing and deleting

Each account card has **History**, **Edit** and **Delete**.

- **History** opens the account's transaction list plus its full detail.
- **Delete** asks for confirmation. Its transactions are kept but become
  unassigned, and the balance history is lost.

Closed accounts stay visible but are excluded from the total balance.

### How balances work

Balance = opening balance + income - expenses - transfers out + transfers in.

Every transaction and transfer recalculates the affected account in the
database. You cannot edit a balance directly, which is deliberate: a balance is
always the sum of the records behind it.

---

## 4. Recording income

**Income** in the sidebar, or the **+ New transaction** button in the header.

1. Set **Type** to Income.
2. Choose the **Account** the money arrived in. This is what makes the balance
   move.
3. Pick a **Category** (Salary, Freelance, Gifts, and so on).
4. Enter the **Amount**, the **Date**, and an optional **Description**.
5. Save.

The account balance increases by the amount. You hear a cash-register cue.

To fix a mistake, use the pencil icon on the row. To remove it, use the cross and
confirm - the balance adjusts back.

**Filters.** Month, type, account, category and a text search. **Clear filters**
resets them. The three summary figures above the table follow the filters, not
just the visible page.

---

## 5. Recording expenses

**Expenses** in the sidebar. Identical to income, with two differences:

- The category list shows expense categories only.
- The account balance **decreases** by the amount.

Everything else - account selection, date, description, editing, deleting,
filters - works the same way.

A category you have not created yet can be added under **Categories** without
losing the form you are in: open Categories in another tab, add it, come back.

---

## 6. Transfers between your accounts

**Transfers** in the sidebar. Use this when money moves between two accounts you
own - moving savings to checking, topping up an e-wallet, withdrawing cash.

A transfer is **not** income and **not** an expense. It moves money sideways. If
you recorded a transfer as an expense, your reports would show spending that
never happened.

### Making a transfer

1. Click **New transfer**.
2. Choose **From** and **To**. You need at least two open accounts. The two must
   differ.
3. Enter the **Amount**.
4. Add a **Note** if it helps later, e.g. "Monthly savings sweep".
5. Optionally set a **Reference**. Leave it blank and the app generates one in
   the form `TRF-YYYYMMDD-XXXXXX`.
6. Review the confirmation dialog - it restates both accounts and the amount -
   and confirm.

Both balances move together. The database posts the transfer inside a single
transaction with both accounts locked, so you can never end up with money
leaving one account and not arriving in the other.

### Transfer history

The Transfers page lists every transfer with its date, both accounts, the amount
and the reference. Delete a transfer to reverse it; both balances adjust.

Closed accounts cannot take part in a transfer. If an account is closed, it
disappears from the From and To lists.

---

## 7. Categories

**Categories** in the sidebar. Each category is either income or expense and can
carry a colour, which is used in charts and legends.

Deleting a category keeps its transactions but marks them uncategorised. Budgets
attached to it are removed.

---

## 8. Budgets

**Budgets** in the sidebar. Set a monthly limit per expense category.

1. Pick the month at the top.
2. Type a limit beside each category. Leave it blank to remove the limit.
3. The bar fills as you spend: green under 85%, amber above, red once you pass
   the limit.

**Copy last month** duplicates the previous month's limits, which is faster than
retyping them.

---

## 9. Reports

**Reports** in the sidebar. Choose **Yearly** or **Monthly**.

You get total income, total expenses, net result, average monthly expense, an
income-versus-expense chart, a spending breakdown by category, a month-by-month
table and period highlights.

**Export CSV** downloads the underlying records for the selected period. The file
is named after the period, e.g. `pinch-report-2026.csv`.

---

## 10. Team and roles

**Team and roles** in the sidebar. Owners and administrators can manage members;
everyone else sees a permission summary instead.

### Roles

- **Owner** - everything, including managing members. There is always one.
- **Administrator** - everything except workspace ownership.
- **Editor** - records transactions and accounts, but cannot delete records,
  manage budgets or manage members.
- **Viewer** - read-only.

### Inviting someone

1. Click **Invite member**.
2. Enter their email, an optional display name, and a role.
3. Add them.

The member record is created straight away. They get access when they sign in
with that email address.

To change a role, use the dropdown on their row. To remove someone, use
**Remove** - their own records stay intact, they simply lose access.

The **Permission matrix** below the member list shows exactly what each role can
do, and **Your access** shows what your own role allows.

---

## 11. Profile

**Profile** in the sidebar.

- Change your **Full name**
- Change the **Currency** used across the app
- Set an optional **Monthly savings target**
- Send yourself a **password reset** email
- **Sign out**
- **Change Supabase project** - forgets the saved connection details

The Account card also shows your role, your user ID, that row level security is
enabled, and when your access token next refreshes.

---

## 12. Sounds

The app plays a short cue when something succeeds:

| Sound | When |
| --- | --- |
| Launch | App opens, sign-in succeeds |
| Cash register up | Income recorded |
| Cash register down | Expense recorded |
| Calculator | Transfer posted |
| Move forward | Transfer confirmed |
| Move back | Record deleted |
| Congratulations | Account created |
| Smart fill | Budget saved |
| Rollover | Reporting period changed |

Sounds never play on an error, and never play twice at once. Browsers block
audio until you interact with the page, so the first click unlocks it - after
that everything plays normally. If a WAV file is missing, that one cue stays
silent and nothing else is affected.

---

## 13. Session behaviour

- Refresh the page - you stay signed in, on the same page.
- Navigate between pages - no reload, no re-login.
- Close the browser and reopen - you stay signed in while the session is valid.
- Sign out - you return to the sign-in screen, and refreshing keeps you there.
- Session expired or revoked elsewhere - you are returned to sign-in and asked to
  sign in again.

You are never logged out simply for refreshing.

---

## 14. Common questions

**Why can I not edit a balance directly?**
Because a balance is derived. Editing it would put it out of step with the
records, and the next recalculation would overwrite your change anyway. Adjust
the opening balance on the account, or add the missing transaction.

**Why does Overall money differ from income minus expenses?**
Because they answer different questions. Income minus expenses tells you how
much you earned and spent in a period. Overall money tells you how much you have
right now, which includes what each account started with and is unaffected by
transfers between your own accounts. Overall money is the sum of your account
balances.

**Does a transfer change Overall money?**
No. Moving money from savings to checking changes both account balances but not
their total.

**Why does my transfer not show in income or expenses?**
It should not. Transfers move money between your own accounts and are excluded
from income and expense totals on purpose.

**Why is a page missing from my sidebar?**
Your role does not include it. See **Team and roles** for the matrix.

**Why did an old account show a zero balance?**
That was a bug in earlier builds: the insert response was read before the
database recalculated. Fixed in Beta 2 - new accounts now show their opening
balance immediately.

**Can I use this on my phone?**
Yes. The layout collapses to a single column and the sidebar becomes a menu
button in the header.
