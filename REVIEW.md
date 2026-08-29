# Product + engineering review — remediation backlog

Compiled from a full page-by-page, action-by-action and schema-level review.
Status is updated as items are implemented.

Legend: `[x]` done, `[ ]` open, `[~]` partially done, `[D]` needs a product decision.

---

## P0 — Security and data integrity

| # | Area | Problem | Why it matters | Status |
|---|---|---|---|---|
| S1 | `api/files/[...key]` | MANAGER branch used `{ expenses: { some: {} } }` — an empty predicate matching every row | Any manager could read every receipt, leave attachment, invoice PDF and payment proof in the company | `[x]` |
| S2 | `authz` / `crew.ts` | `redactStaff`/`canSeeSensitiveStaffFields` were dead code; `getCrewSession` returned the raw Staff row | NI number, tax code, sort code, DOB and home address serialised to the browser on every crew page load | `[x]` |
| S3 | `admin.ts` | `getStaff`, `getTimesheetData`, `getDashboardStats`, `getRecentActivity`, `getWeeklyHours`, `getPendingCounts`, `getLeaveContext` applied no manager scope | A MANAGER saw the whole company roster, contact details and org-wide financial activity | `[x]` |
| S4 | `audit.ts` | Scrub list missed `taxCode`, `bankAccountLast4`, `dateOfBirth`, address, emergency contacts; `addStaffMember` wrote the whole row as `after` | Every new-starter audit row stored home address and tax code in queryable JSON | `[x]` |
| S5 | `admin.ts` | Leave `leaveYear` derived from `from` but balance checked against the current year | An employee could book all of next year's allowance in December with no balance check | `[x]` |
| S6 | schema | `Attendance`, `Timesheet`, `LeaveRequest`, `StaffPayRate`, `StaffDocument`, `PayrollAdjustment` cascaded from their parent | Deleting a staff row destroyed attendance, approved leave, pay-rate history and PTS compliance evidence | `[x]` |

## P1 — Broken core workflows

| # | Area | Problem | Status |
|---|---|---|---|
| W1 | Payroll | `approved` and `paid` unreachable — no generation, approval, lock or payment action existed. `getPayslips` filters on those states, so **no employee could ever see a payslip** | `[x]` |
| W2 | Invoices | Nothing ever wrote `sentAt`; `canTransition` was dead code; a draft invoice stayed draft forever and was excluded from every financial total | `[x]` |
| W3 | Invoices | The create dialog posted `{amountPence, status}` but the schema requires `lineItems[]` — **every invoice submission failed validation silently** | `[x]` |
| W4 | Expenses/Leave | Decision buttons never checked `ActionResult`; "Mark reimbursed" and "Reject" always failed server-side while showing a success toast | `[x]` |
| W5 | Invoices | No UI to record a payment or void — an invoice could never legitimately reach `paid` | `[x]` |
| W6 | Timesheets | Locked-week guard matched on the week's Monday falling in the edited range, so a mid-week edit bypassed the lock and overwrote approved attendance | `[x]` |
| W7 | Timesheets | No approval UI; `approved` unreachable (decide wrote `locked`); no unlock path | `[x]` |
| W8 | Staff | Only `leaver` reachable. No suspend, notice, reinstate, archive, or any staff edit action | `[x]` |
| W9 | Documents | `StaffDocument` had no create/read/review/expiry code at all — the PTS/medical/right-to-work compliance record did not exist in the product | `[x]` |
| W10 | Notifications | `markNotificationRead`/`listNotifications`/`unreadCount` had no callers. Notifications were written and then invisible | `[x]` |
| W11 | Staff creation | Form sent `status` where the schema expects `availability` with different values, and `crewId: ''` which fails uuid validation — new staff silently got the wrong availability or the save failed | `[x]` |
| W12 | Dates | UTC/BST boundary bugs: pay period, week boundaries, "is in the future" checks and self-cancel windows were all wrong for up to an hour each day during BST | `[x]` |
| W13 | Leave | `taken` unreachable, so leave never settled and the overlap constraint blocked against historic leave forever | `[x]` |

## P2 — Missing business data / UX

| # | Area | Problem | Status |
|---|---|---|---|
| D1 | Onboarding | Form collected 9 fields; omitted contract type, weekly hours, day rate, manager, job title, address, emergency contact, NI/tax — all of which the schema already had | `[x]` |
| D2 | Leave | Entitlement was a single org-wide number; no pro-rating for mid-year joiners or part-timers, and carry-over was global | `[x]` |
| D3 | Expenses | No VAT and no job costing captured, so input VAT was never reclaimable | `[x]` |
| D4 | Invoices | No line items, PO number, notes or job link in the UI; due date ignored the client's payment terms | `[x]` |
| D5 | Crew portal | No notifications, no documents, no personal-details page, no payslip history, no leave cancel, no half-day booking | `[x]` |
| D6 | Finance | "Outstanding" omitted `sent`/`partially_paid` and summed gross instead of balance; no aged receivables | `[x]` |
| D7 | Tables | No sorting anywhere; no pagination on unbounded lists; filters missing real enum members | `[~]` |
| D8 | Crews table | Row action menu ("View profile", "Edit", "Assign to job") entirely unwired | `[x]` |
| D9 | Payslip | Watermarked "Sample document for demo purposes" | `[x]` |
| D10 | Settings | "Custom" working-days option rejected the whole save; manual holidays were state-only theatre | `[x]` |

## P3 — Architecture

| # | Problem | Status |
|---|---|---|
| A1 | Date helpers defined three times; manager-scope predicate inlined twice (the direct cause of S3) | `[x]` |
| A2 | `attendanceHours` duplicated between `admin-data.ts` and `payroll.ts`; finance dashboard recomputed hours in the browser | `[x]` |
| A3 | `admin.ts` at ~2,050 lines mixes eleven domains | `[x]` |
| A4 | Sequential `await`s where `Promise.all` applies | `[x]` |
| A5 | Two different action result shapes (`{error}` vs `ActionResult`) | `[x]` |

## Requires a product decision

See the "Remaining product decisions" section of the final report.
