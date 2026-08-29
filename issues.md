I've verified the critical findings directly in the source. Here is the full audit.

---

# 1. Executive Summary

**Overall assessment: this is a well-crafted UI prototype sitting on an unsecured backend. It is not production-ready, and the gap is not a matter of polish — it is structural.**

The craftsmanship is genuinely uneven in an unusual way. Two modules — the leave engine (`app/lib/leave.ts` + the four-step dialog) and the bulk attendance entry dialog — are better than most production code: shared client/server maths, server-side re-validation, write caps, explicit overwrite semantics, live previews. Then the same repository contains a sign-in action that registers any unknown email as an administrator.

**Production readiness: no. I would estimate 8–12 weeks of focused work for a small team before this can hold real employee and payroll data.**

**Biggest security risks (all confirmed by reading the code, not inferred):**

1. **`app/actions/auth.ts:58-77` — sign-in falls through to sign-up on failure.** Any email plus any password that fails authentication is *registered instead*. Combined with the role model below, this is an open, unauthenticated, self-service administrator registration endpoint. This is the single most severe finding in the audit.
2. **The role model is inverted by omission.** There is no role column. "Admin" is defined as *the absence of a `Staff` row* (`app/actions/auth.ts:256-262`, consumed at `app/lib/api-auth.ts:19`, `app/page.tsx:12`, `app/admin/layout.tsx:22`). So a brand-new self-registered account, having no `Staff` row, is routed to `/admin/dashboard` with full payroll, invoice, staff and SMTP access. Failure mode is open-by-default: every bug that prevents a `Staff` row from being created *grants* admin.
3. **Not one of the ~20 exported Server Actions in `app/actions/admin.ts` performs any session or role check.** The file imports `auth` (line 9) and uses it solely to send an invite email (line 846). `decideLeaveRequest`, `decideExpense`, `addPayrollAdjustment`, `addStaffMember`, `addInvoice`, `saveSettings` are all callable by any authenticated user — including any crew member — via a forged Server Action request. The layouts gate rendering only. The README's claim at lines 227-231 that "a layout check alone would not protect Server Actions, so the actions... re-derive that employee from the session" is true of `app/actions/crew.ts` and false of `app/actions/admin.ts`.
4. **A direct IDOR on payslips.** `getCrewLatestPayslip(staffRef)` (`app/actions/crew.ts:327-348`) is an exported Server Action that takes an arbitrary `staffRef` and performs no authentication whatsoever. Any authenticated user can read any employee's gross, tax, NI, pension and net pay by passing their reference.
5. **SMTP credentials stored and served in plaintext.** `SmtpSettings.pass` (schema line 235) is written unencrypted, returned by `getSettings()` (`app/actions/admin.ts:124`), rendered into the settings page HTML as an input `defaultValue`, and exposed by `GET /api/admin/settings`. `POST /api/admin/settings` takes an arbitrary unvalidated object and writes it to disk with `fs.writeFileSync`.
6. **The session secret has a hardcoded fallback.** `app/lib/auth.ts:80` defaults to `"default-better-auth-secret-key-123456"` if `BETTER_AUTH_SECRET` is unset — a deploy that forgets one environment variable gets publicly-known session signing keys, meaning forgeable sessions. The README documents this as acceptable.

**Biggest functional gaps:** the entire HR profile described in the README does not exist (the `Staff` model has ten columns); there is no `StaffDocument` model; there is no employee detail page; there is **no delete or update capability anywhere in the application** for any entity; there is no way to offboard an employee; there is no notification system despite four notification toggles in settings; there is no audit trail despite an `auditLog` toggle in settings.

**Biggest database risks:** no migrations at all (`db push` only, generated client committed); every enum is a bare `String` with the legal values in a comment; money-critical multi-write flows have no transactions; no soft deletes, so the delete capability that must eventually be added has nowhere safe to land.

**Biggest UX problems:** no `loading.tsx`, no `error.tsx`, no `global-error.tsx` anywhere in the app — one `app/not-found.tsx` is the only special file. Every page is an async Server Component doing sequential Prisma round-trips with no Suspense boundary. And a pervasive "toast-before-write" pattern means the UI announces success before attempting the database write, then leaves the optimistic value on screen when the write fails.

---

# 2. System Architecture

## Reconstructed intent

Work à Rail is an internal workforce-operations system for a UK rail labour-supply contractor. Three portals over one Postgres database: **Admin** (`/admin`, operations + HR), **Finance** (`/finance`, money views), **Crew** (`/crew`, employee self-service). Portal selection happens at sign-in by redirect.

## Actual flow

```
Browser
  │
  ├─► Server Component page (async, direct Prisma) ──────┐
  │      no Suspense, no error boundary                  │
  │                                                      ▼
  ├─► Server Action  ──────────────────────────►  app/actions/{admin,crew,auth}.ts
  │      THE ONLY PATH THE UI USES                       │  admin.ts: NO auth checks
  │      admin.ts actions are UNAUTHENTICATED            │  crew.ts:  getCrewSession() ✓
  │                                                      ▼
  └─► /api/* JSON routes  ──► getSessionAndRole() ──►  same actions ──► Prisma ──► Postgres
         EXTERNAL CONSUMERS ONLY                                            │
         these ARE gated (but on the inverted role)                         ▼
                                                          Nager.Date / Google iCal / SMTP
```

## Architectural inconsistencies

**The security boundary is on the path nobody uses.** `app/api/*` routes correctly call `getSessionAndRole()` and return 403. The Server Actions — which is what every page and dialog actually invokes — do not. The protection was applied to the secondary interface. This is the defining architectural flaw of the codebase.

**Three sources of truth for configuration.** Organisation settings live in `app/lib/settings.json`, written with `fs.writeFileSync` into the *source tree* (`app/actions/admin.ts:151`). SMTP settings live in Postgres. Environment fallbacks live in `.env`. The file-based store does not survive a container deploy, diverges per replica in any multi-instance deployment, blocks the event loop on every read (`fs.readFileSync`, line 105), and races between concurrent admins. It cannot go to production in this form.

**`app/lib/admin-data.ts` is half-live, half-fossil.** 596 lines exporting the load-bearing helpers `computePay`, `attendanceHours`, `formatMoney` alongside hardcoded demo arrays and, critically, `export const today = '2026-08-25'` (line 8) and `export const payPeriod = { year: 2026, month: 8 }` (line 346) — frozen dates still exported from a module the live code imports. Any consumer that reaches for `today` instead of `new Date()` is silently pinned to August 2026.

**Business logic is duplicated rather than shared.** Leave day computation exists twice: `computeLeave` in `app/lib/leave.ts` (holiday-aware, half-day aware, re-run server-side) and a private `workingDays()` in `app/ui/crew/leave-form.tsx:24-37` (calendar-only, ignores public holidays). Admin and crew therefore compute *different* day counts for identical dates. Expense creation exists twice (`admin.ts:348` and `crew.ts:275`) with different validation. The README asserts single-module sharing; it holds for the admin path only.

**No migration history.** `db push` with the generated client committed under `generated/`. There is no way to roll a schema change forward or back, no way to review a schema diff in a PR, and no way to deploy safely to an environment with real data.

---

# 3. Complete Module Audit

| Module | Existing | Missing | Bugs | Risk | Priority |
| --- | --- | --- | --- | --- | --- |
| **Auth / Session** | Sign-in, sign-out, forgot/reset password, Google OAuth, scrypt+salt | Sign-up (intentionally), MFA, rate limiting, lockout, session revocation, password policy, email verification | Sign-up fallthrough (`auth.ts:58-77`); hardcoded secret fallback (`lib/auth.ts:80`); dev mock admin `mock-admin@workarail.com`/`mock-password-123` (`auth.ts:107-127`) | 🔴 Critical | P0 |
| **RBAC** | Binary staff/non-staff derived from row existence | Role column, admin vs finance vs manager separation, permission checks in Server Actions, ownership checks | Inverted default (absence = admin); finance and admin identical | 🔴 Critical | P0 |
| **Staff / HR** | Create (9 fields), list, inline date edit | Update, delete/offboard, detail page, ~20 HR fields, `StaffDocument`, documents, contract terms, pay rate, compliance expiries | No transaction across 4 writes (`admin.ts:816-892`); orphaned User+Account on partial failure *grants admin*; `hashPassword` missing `return` after `reject` (line 798) | 🔴 Critical | P0 |
| **Crews** | Create, list | Update, delete, reassign, supervisor, site, capacity | No duplicate pre-check on `@unique` name → raw Prisma 500 | 🟡 Medium | P2 |
| **Jobs** | Read-only table | Everything — no create, no assignment UI, `Staff.currentJobId` unsettable | Model has no client, dates, or status | 🟠 High | P1 |
| **Attendance / Timesheets** | Weekly grid, bulk range entry (excellent), crew self-submit | Approval workflow, per-day hours, start/end times, overtime, job/cost-code allocation, notes, lock-after-period, historical week navigation | Crew submit has no `$transaction` (`crew.ts:213-235`); no code validation → arbitrary strings stored → `NaN` hours (`crew.ts:96`); "locks after submission" is local state only, lost on reload | 🟠 High | P1 |
| **Leave** | 4-step admin dialog, approve/reject, holiday-aware maths, allowance/clash checks | Cancellation, amendment, carry-over ledger, accrual, fit-note attachment, year-end rollover, delegation, notifications | Crew path trusts client `days` outright and skips all four server checks (`crew.ts:244-273`); never sets `deducts`, so unpaid leave wrongly deducts | 🔴 Critical | P0 |
| **Expenses** | Create (admin + crew), approve/reject/reimburse, receipts | Update, delete, withdraw, rejection reason, approver identity, policy limits, mileage, VAT, duplicate detection, reimbursement batch | `decideExpense` unauthenticated, no state machine (rejected → reimbursed replayable); admin receipts stored as `blob:` URLs, permanently broken after reload (`expenses-table.tsx:430`); crew receipts stored as multi-MB base64 in a Postgres `String` | 🔴 Critical | P0 |
| **Invoices** | Create, list, status filter | Update, delete, void, send, payment records, partial payments, line items, VAT, PO, credit notes, overdue automation | `status: 'paid'` selectable at creation with no proof; no `min` on amount → negative invoices; `due` can precede `issued`; client matched by case-sensitive `findFirst` → duplicate `Client` rows; 5-char `Math.random()` invoice IDs | 🔴 Critical | P0 |
| **Payroll** | Monthly records, adjustments, payslip print | Payroll run, mark-paid, recalculation from attendance, YTD, P60/P45, RTI, pay rates, statutory bands | `computePay` hardcodes 20%/8%/5% and one allowance for everyone (`admin-data.ts:332-343`); adjustment reason text is collected then **discarded**; adjustment hardcoded to current month; no audit row | 🔴 Critical | P0 |
| **Clients** | Implicit creation only | Entire CRUD, billing address, VAT/company number, payment terms, contacts, credit limit | Model has `id`, `name`, timestamps — nothing else | 🟠 High | P1 |
| **Settings** | 24 fields, dirty-bar, SMTP | Validation of any kind, secret encryption, per-org scoping, change history | Written to source tree; `twoFactor`/`auditLog`/`sessionTimeout` are decorative — nothing reads them; toast fires before save | 🔴 Critical | P0 |
| **Holidays** | Nager + Google iCal, region filter, caching | Persistence for manual entries | The manual-holiday panel is a stub — `// TODO: entries live in component state only` (`manual-holidays.tsx:27`) yet the toast claims "added to the holiday calendar"; `holiday-filter.tsx:37` sets `pending` and never resets it | 🟡 Medium | P2 |
| **Analytics / Dashboard** | Stat cards, charts, activity feed | Date-range selection, drill-down, export, KPIs, forecasting | `getDashboardStats` loads the entire staff table with three includes to compute `.length`; exact-match date filter silently reads 0; local/UTC mixing at `admin.ts:534`; label/value mismatch on "Awaiting approval" | 🟡 Medium | P2 |
| **Notifications** | Nothing | Everything — see §9 | Four settings toggles imply a system that does not exist | 🟠 High | P1 |
| **Audit** | Nothing | Everything | `auditLog: true` in settings is decorative | 🔴 Critical | P0 |

---

# 4. Complete Form Audit

Seventeen forms and dialogs. None omitted.

| # | Form | Existing Fields | Missing Fields | Validation Issues | UX Issues | Pri |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Sign-in** `ui/signin-form.tsx` | email; password; remember | — | `noValidate`, no `required` (server-side only, acceptable) | Best form in the app: pending state, disabled controls, `aria-invalid`, password reveal. **No rate limit, no lockout, no CAPTCHA** | P0 |
| 2 | **Forgot password** `ui/forgot-password-form.tsx` | email | — | Enumeration-safe ✓ | No resend cooldown; success panel lacks `role="status"` | P2 |
| 3 | **Reset password** `ui/reset-password-form.tsx` | token (hidden); password; confirm | — | No `required`, no `minLength={8}`, no `autoComplete="new-password"`, no strength meter — 8-char rule is server-only, one round-trip per typo | Error `<p id>` referenced by nothing; no `aria-invalid` | P2 |
| 4 | **Add Crew** `ui/admin/crews-table.tsx:387` | name | Supervisor, site, depot, capacity, active flag | No `maxLength`, no trim, no duplicate pre-check on a `@unique` column | Plain `<div>` — no `role="dialog"`, no focus trap, no Escape; **no disabled-on-submit** (double-submit); `alert(String(err))` shows raw Prisma text | P2 |
| 5 | **Add Staff** `ui/admin/crews-table.tsx:439` | ref, name, email, phone, role, crewId, status, joined, birthday (9) | **~20:** address, emergency contact, contract type, hours, day rate/salary, notice, end date, NI number, tax code, bank sort code + account, right-to-work status + expiry, PTS/Sentinel number + expiry, medical expiry, next of kin, `currentJobId`, leaver status | No `pattern` on `ref` (the PK everything joins on); no `max` on `joined` (hire in 2074); birthday regex accepts `02-30`; **zero server-side validation** | No loading/disabled state; `alert()` on error; no `role="dialog"`; **`status` has no leaver option — nobody can be offboarded** | P0 |
| 6 | **Attendance entry** `ui/admin/attendance-entry-dialog.tsx` | search, staff checkboxes, day/range mode, day or from/to, code radio ×5, includeWeekends, overwrite | Job/cost code, hours, notes, reason for absence | Strong: server re-validates codes, ISO format, range order, caps at 500 writes | **The best dialog here.** `aria-modal`, Escape, scroll lock, `aria-live` footer. Missing: focus trap, focus restore, date `max`, confirm-on-overwrite-conflict | P3 |
| 7 | **Leave request (admin)** `ui/admin/leave-request-dialog.tsx` | staffRef, type ×5, from/to, startAt/endAt, reason, approveNow | Fit-note attachment, delegate/cover, handover notes | Excellent — server re-runs `computeLeave`, re-checks clash and allowance | Missing focus trap/restore; no date `max`; `reason` optional here but **required** on the crew form | P3 |
| 8 | **New Invoice** `ui/admin/invoices-table.tsx:258` | clientName, reference, amount, status, issued, due | Line items, VAT, currency, PO number, payment terms, notes, contact, linked job | **No `min` on amount → negative invoices**; `NaN` from `parseFloat` passed straight to Prisma; **no `min={issued}` on due**; **`paid` selectable with no proof**; free-text client name | No loading/disabled; `alert()`; **every `<label>` lacks `htmlFor`, every input lacks `id` — fields are unlabelled to screen readers**; no edit/delete/mark-paid actions exist at all | P0 |
| 9 | **Expense decide** `ui/admin/expenses-table.tsx:314` | Approve/Reject/Reimburse buttons | Rejection reason, approver, comment thread | No state machine — rejected → reimbursed is replayable | **No confirmation on Reject**; success toast fires *before* the write; optimistic override never reverted on failure | P1 |
| 10 | **Add expense (admin)** `ui/admin/expenses-table.tsx:382` | merchant, amount, description, date, category, staffRef, method, receipt | VAT, project/job, mileage, currency | No `max` on date (future-dated expenses); no file size/MIME check | Native `<dialog>` ✓, labels ✓. **Receipt URL is `URL.createObjectURL(file)` persisted to the DB — every admin-side receipt is permanently broken after reload**; ID is `EX-${4022 + all.length}` — guaranteed collisions | P0 |
| 11 | **Payroll adjustment** `ui/admin/payroll-table.tsx:274` | staffRef, label, kind, amount | Effective date, period selector, category, approver, taxable flag | No cap — a deduction can drive gross negative and `computePay` returns nonsense | **The "Reason" label the user types is never persisted anywhere**; hardcoded to current month; throws raw `Error` if no record exists; no rollback on failed write | P1 |
| 12 | **Settings** `ui/admin/settings-form.tsx` | 24 fields | Company address, VAT/company number, logo, fiscal year, pay rates, approval thresholds | **No `required`, no `min` anywhere** — negative leave entitlement saves; `smtpFrom` is `type=text`; `saveSettings` validates nothing | Only form with an unsaved-changes guard ✓ (but `beforeunload` misses client-side navigation). Toast fires before save and clears the dirty flag first, so a failed save shows "Saved." with no retry path. **SMTP password sits in page HTML** | P0 |
| 13 | **Manual holidays** `ui/admin/manual-holidays.tsx` | date, name | Region, recurrence, persistence | Neither field `required` | **The entire panel is a stub** — state-only, resets on reload, never reaches `getLeaveContext`. The toast says "added to the holiday calendar". The README presents this as working | P1 |
| 14 | **Holiday filter** `ui/admin/holiday-filter.tsx` | country, region, year | — | — | `pending` set true and **never reset** — "Loading…" persists forever after the first change; empty state tells users to "try Apply again" but there is no Apply button | P2 |
| 15 | **Celebrations date edit** `ui/admin/celebrations.tsx:400` | birthday, joined | — | Neither `required`; no `max` | Clearing both writes `birthday: ""` and **`joined: new Date("1970-01-01")`** (`admin.ts:770-772`) — silent corruption producing a 56-year work anniversary. No confirmation on Clear | P1 |
| 16 | **Crew leave** `ui/crew/leave-form.tsx` | type, from, to, reason (required) | Half-day selection, attachment, emergency contact during absence | Client checks are good; **server does none** — trusts `days` outright, no recompute, no holiday check, no overlap check, no balance check. Uses a *different* day-count function than admin | No disabled-on-submit → **double-submit creates two requests**; `to` has `min={today}` not `min={from}` | P0 |
| 17 | **Crew timesheet** `ui/crew/timesheet-form.tsx` | 7 day selects | Hours, start/end times, breaks, overtime, job/cost code, notes | No server-side code validation | No `<form>`; no disabled-on-submit; **"locks after submission" is local state, lost on reload** — there is no schema field for submission at all | P1 |
| 18 | **Crew expenses** `ui/crew/expense-claims.tsx` | merchant, amount, description, date (`max=today` ✓), category, method, receipt | VAT, mileage/rate, project | Amount validated ✓; server validates nothing — negatives, future dates, unknown category/method all pass | Labels associated ✓. **Receipt read as a data URL and written into a `String` column — a 10 MB photo becomes a ~13 MB row, re-sent on every page load**; no size cap; double-submit creates two claims | P0 |

---

# 5. Database Audit

| Entity | Problems | Missing Fields | Relationship Issues | Constraints | Indexes | Sev |
| --- | --- | --- | --- | --- | --- | --- |
| `User` | No role/permission column — the root cause of the RBAC failure | `role`, `isActive`, `lastLoginAt`, `mfaSecret`, `failedLoginCount`, `lockedUntil` | `staff Staff?` optional both ways, so a User with no Staff is admin-by-accident | — | `email` unique ✓ | 🔴 |
| `Session` | No revocation flag; `sessionTimeout` setting ignored | `revokedAt`, `lastActiveAt` | Cascade ✓ | — | **No index on `userId`** — session lookup scans | 🟠 |
| `Account` | Passwords in `String?`; `@@unique([issuer, accountId])` with `issuer` defaulted is fragile | `passwordChangedAt`, `previousHashes` | Cascade ✓ | — | **No index on `userId`** | 🟡 |
| `Verification` | No cleanup of expired rows | `consumedAt` (tokens are reusable until expiry) | — | — | **No index on `identifier`** | 🟠 |
| `Crew` | No lifecycle | `supervisorRef`, `site`, `depot`, `isActive`, `capacity` | No supervisor relation | `name` unique ✓ | ✓ | 🟡 |
| `Job` | Client-supplied PK; almost empty | `clientId`, `startDate`, `endDate`, `status`, `location`, `rate` | **No relation to `Client`** — jobs and invoices are unconnected, so there is no client → job → invoice chain | — | ✓ | 🟠 |
| `Staff` | **Ten columns where the README promises ~30.** `birthday` is a `String` "MM-DD" (unsortable, unvalidatable, and API docs use `YYYY-MM-DD`). `status` is free text. No soft delete | Address, emergency contact, NI number, tax code, bank details, contract type, hours, pay rate, notice, **`endDate`/leaver status**, right-to-work + expiry, PTS/Sentinel + expiry, medical expiry, `managerRef` | `crewId` is **non-null**, so a crew cannot be dissolved; `crew` FK has **no `onDelete`** → Restrict, meaning crew deletion fails with a raw error; `userId` `SetNull` orphans the login | No check constraints on `status` | ✓ `crewId`, `currentJobId`, `status`. **No index on `email`** despite `checkIsStaff` querying it on every request | 🔴 |
| `StaffDocument` | **Does not exist.** README line 241 lists it; the schema defines fourteen models, not fifteen | The entire model | No document storage anywhere | — | — | 🟠 |
| `Attendance` | `code` is a free `String` — arbitrary values are already writable via the crew API and produce `NaN` hours | `hours`, `startTime`, `endTime`, `jobId`, `notes`, `submittedAt`, `approvedBy`, `approvedAt`, `source` | No job/cost-code link | `@@unique([staffRef, date])` ✓. **No check constraint on `code`** | **No index on `date` alone** — every weekly range query scans | 🔴 |
| `LeaveRequest` | `status`/`type` free strings; no cancellation state | `decidedBy`, `cancelledAt`, `attachmentId`, `comment`, `year` (for rollover) | No approver relation — **no record of who approved anything** | No check constraints; **no exclusion constraint preventing overlapping leave** (enforced only in one of two code paths) | ✓ `staffRef`, `status`. No composite `[staffRef, from, to]` | 🔴 |
| `Attachment` | `size` is a `String`; `url` holds data URLs, blob URLs, anything | `mimeType`, `sizeBytes`, `uploadedBy`, `checksum`, `storageKey` | Three relations in, no `onDelete` on any — deleting an attachment breaks invoices/expenses | — | None | 🟠 |
| `Client` | Three real columns | Legal name, billing address, VAT/company number, payment terms, currency, credit limit, contacts, status | `invoices` only; **no link to `Job`** | `name` unique but matched case-sensitively in code → near-duplicates | **No index needed, but no `name` index for the datalist lookup** | 🟠 |
| `Invoice` | `status` free string; **no payment records at all** | `vatPence`, `netPence`, `currency`, `poNumber`, `terms`, `notes`, `sentAt`, `viewedAt`, `paidAt`, `voidedAt`, `createdBy`, line items | `client` FK has **no `onDelete`**; no link to `Job` or `Staff` | `reference` **not unique** — duplicate invoice references are legal | ✓ `clientId`, `status`, `issued`. Missing `due` (overdue queries) | 🔴 |
| `Expense` | `status`, `category`, `method` free strings | `approvedBy`, `approvedAt`, `rejectionReason`, `reimbursedAt`, `paymentRef`, `vatPence`, `jobId`, `mileage` | `receipt` FK no `onDelete`; **no approver relation** | No check constraints; **no non-negative constraint on `amountPence`** | ✓ `staffRef`, `status`, `date` | 🟠 |
| `PayrollRecord` | No pay-rate provenance; adjustments mutate gross in place with no history | `adjustments[]`, `hoursWorked`, `rate`, `ytdGross`, `ytdTax`, `approvedBy`, `payslipUrl`, `taxCode`, `niCategory` | No link to the attendance it was derived from | `@@unique([staffRef, year, month])` ✓; `reference` unique ✓. **No non-negative constraints** | **No index on `[year, month]`** — the dashboard's primary query | 🔴 |
| `SmtpSettings` | **Plaintext password**; single-row table with a magic `"default"` id | `encryptedPass`, `updatedBy` | — | — | — | 🔴 |
| *(missing)* `AuditLog` | **Does not exist** | actor, action, entity, entityId, before, after, ip, userAgent, at | — | — | — | 🔴 |
| *(missing)* `Notification` | **Does not exist** | recipient, type, payload, readAt, channel | — | — | — | 🟠 |
| *(missing)* `Payment` | **Does not exist** — invoices have a status but no payment records, so partial payments are unrepresentable | invoiceId, amount, date, method, reference | — | — | 🔴 |

## Recommended schema changes

```prisma
enum UserRole { ADMIN FINANCE MANAGER CREW }
enum LeaveStatus { PENDING APPROVED REJECTED CANCELLED }
enum InvoiceStatus { DRAFT ISSUED SENT PARTIALLY_PAID PAID OVERDUE VOID }
enum ExpenseStatus { SUBMITTED APPROVED REJECTED REIMBURSED }
enum AttendanceCode { P H L A NONE }

model User {
  role       UserRole @default(CREW)   // explicit; never inferred from absence
  isActive   Boolean  @default(true)
  lockedUntil DateTime?
  @@index([role])
}

model Staff {
  // + ~20 HR columns (address, NI, tax code, bank, contract, rates)
  endDate      DateTime?               // enables offboarding
  managerRef   String?
  ptsExpiry    DateTime?
  medicalExpiry DateTime?
  rightToWorkExpiry DateTime?
  deletedAt    DateTime?               // soft delete
  crewId       String?                 // nullable, so a crew can be dissolved
  @@index([email])
  @@index([deletedAt])
}

model StaffDocument {
  id String @id @default(uuid())
  staffRef String
  staff Staff @relation(fields: [staffRef], references: [ref], onDelete: Cascade)
  kind String   // 'pts' | 'medical' | 'rtw' | 'contract'
  expiresAt DateTime?
  attachmentId String
  @@index([staffRef, kind])
}

model Payment {
  id String @id @default(uuid())
  invoiceId String
  invoice Invoice @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  amountPence Int
  receivedOn DateTime
  method String
  reference String @unique          // idempotency
  @@index([invoiceId])
}

model AuditLog {
  id String @id @default(uuid())
  actorUserId String
  action String
  entity String
  entityId String
  before Json?
  after Json?
  ip String?
  at DateTime @default(now())
  @@index([entity, entityId])
  @@index([actorUserId, at])
}
```

Plus, in raw SQL alongside the enums: `CHECK (amount_pence >= 0)` on `Invoice`, `Expense`, and every `PayrollRecord` money column; `CHECK (due >= issued)` on `Invoice`; `CHECK ("to" >= "from")` on `LeaveRequest`; a `btree_gist` exclusion constraint on `LeaveRequest (staffRef, daterange(from, to))` to make overlapping leave *impossible* rather than merely checked in one code path; and `UNIQUE (clientId, reference)` on `Invoice`.

**And before any of this: adopt `prisma migrate`.** Every change above is unshippable to an environment with real data while the project uses `db push`.

---

# 6. API / Backend Audit

Two surfaces. The Server Actions are what the app uses; the REST routes are what is protected.

## Server Actions — `app/actions/admin.ts` (the real attack surface)

| Action | Auth | Authz | Validation | Errors | DB | Sev |
| --- | --- | --- | --- | --- | --- | --- |
| `addStaffMember` | ❌ **none** | ❌ | None | Throws raw Prisma | **4 writes, no transaction**; partial failure orphans User+Account → **admin grant** | 🔴 |
| `addCrew` | ❌ | ❌ | None | Raw | Single write | 🔴 |
| `addInvoice` | ❌ | ❌ | None | Raw | Read-then-write race on Client; no transaction | 🔴 |
| `addExpense` | ❌ | ❌ | None | Raw | 2 writes, no transaction → orphaned Attachment | 🔴 |
| `decideExpense` | ❌ | ❌ | Status not checked against current state | Raw | Any status → any status | 🔴 |
| `decideLeaveRequest` | ❌ | ❌ | No state machine; no approver recorded | Raw | Approved leave re-approvable | 🔴 |
| `createLeaveRequest` | ❌ | ❌ | **Genuinely good** — recomputes days, checks clash and allowance | Returns `{error}` ✓ | Clash check is read-then-write, racy | 🟠 |
| `saveAttendanceEntries` | ❌ | ❌ | **Good** — codes, ISO dates, order, 500-write cap | Returns `{error}` ✓ | `$transaction` ✓ | 🟠 |
| `addPayrollAdjustment` | ❌ | ❌ | No cap, no sign check | Throws raw `Error` | Read-then-write on gross; reason discarded | 🔴 |
| `saveSettings` | ❌ | ❌ | **Zero** — arbitrary object | **Returns `{success:false}` instead of throwing** | File write + DB write, no transaction, can diverge | 🔴 |
| `getSettings` | ❌ | ❌ | — | Swallows | **Returns plaintext SMTP password to any caller** | 🔴 |
| `updateStaffDates` | ❌ | ❌ | None | Raw | Nulls → `1970-01-01` corruption | 🟠 |
| `getStaff` / `getPayrollRecords` / `getInvoices` / `getExpenses` | ❌ | ❌ | — | — | Unbounded `findMany` — full-table PII dumps | 🟠 |

## Server Actions — `app/actions/crew.ts`

| Action | Auth | Authz | Validation | Sev |
| --- | --- | --- | --- | --- |
| `getCrewSession` | ✓ | ✓ | — | Performs a **write inside a read** (`crew.ts:60-65`), racy 🟡 |
| `getCrewDashboardData` | ✓ | ✓ own | — | `NaN` hours on unknown codes 🟡 |
| `saveCrewTimesheet` | ✓ | ✓ own | **No code validation** | 🟠 No transaction across 7 upserts |
| `submitCrewLeaveRequest` | ✓ | ✓ own | **None** — trusts client `days`, no overlap, no balance | 🔴 |
| `submitCrewExpense` | ✓ | ✓ own | **None** — negatives, future dates, unvalidated `receipt.url` (stored-XSS vector) | 🔴 |
| **`getCrewLatestPayslip`** | ❌ **none** | ❌ **arbitrary `staffRef`** | — | 🔴 **Direct IDOR — anyone reads anyone's pay** |

## REST routes — `app/api/*`

All fourteen share: no PUT/PATCH/DELETE, no pagination, no rate limiting, no idempotency, no audit logging, no `Content-Type` check (non-JSON → 500 instead of 400), and every catch echoes raw `error.message` to the client while logging nothing server-side.

| Endpoint | Auth | Authz | Validation | Errors | Sev |
| --- | --- | --- | --- | --- | --- |
| `GET/POST /api/auth/[...all]` | better-auth | — | delegated | delegated | 🟠 no `rateLimit` config |
| `GET /api/admin/stats` | ✓ | inverted role | — | leaks | 🟠 |
| `GET /api/admin/staff` | ✓ | inverted | — | leaks | 🟠 unbounded PII dump |
| `POST /api/admin/staff` | ✓ | inverted | truthiness only; no types, no email format, no `crewId` existence | dup → **500 not 409** | 🔴 |
| `GET/POST /api/admin/crews` | ✓ | inverted | `!name` only | dup → 500 | 🟡 cleanest handler |
| `GET /api/admin/invoices` | ✓ | inverted | — | leaks | 🟠 unbounded |
| `POST /api/admin/invoices` | ✓ | inverted | negatives/`NaN`/floats pass; status not enum-checked; dates unordered | 500s | 🔴 |
| `GET /api/admin/expenses` | ✓ | inverted | — | leaks | 🟠 **no approve endpoint exists** |
| `GET /api/admin/leaves` | ✓ | inverted | — | leaks | 🟠 **no approve endpoint exists** |
| `GET /api/admin/payroll` | ✓ | inverted | — | leaks | 🟠 all pay for all staff, unbounded, no secondary sort |
| `GET /api/admin/settings` | ✓ | inverted | — | leaks | 🔴 **returns SMTP password** |
| `POST /api/admin/settings` | ✓ | inverted | **none — arbitrary JSON to disk** | **failure returns HTTP 200 `success:true`** | 🔴 |
| `GET /api/crew/dashboard` | ✓ | ✓ own | — | `redirect()` inside a route → **500 with `NEXT_REDIRECT`** | 🟡 |
| `GET/POST /api/crew/timesheet` | ✓ | ✓ own | `Array.isArray` only — length and elements unchecked, arbitrary strings stored | leaks | 🔴 |
| `POST /api/crew/leave` | ✓ | ✓ own | `typeof days === 'number'` — **`-1000` and `NaN` pass and inflate the balance** | leaks | 🔴 |
| `POST /api/crew/expenses` | ✓ | ✓ own | `receipt` passed through entirely unvalidated | leaks | 🔴 |
| `GET /api/crew/payslips` | ✓ | ✓ **own, correctly** | — | leaks | 🟡 the model to copy |

---

# 7. RBAC Matrix

## Intended

| Action | Admin | Finance | Manager | Crew |
| --- | :-: | :-: | :-: | :-: |
| View/create/edit staff | ✓ | ✗ | own crew | ✗ |
| Approve leave | ✓ | ✗ | own crew | ✗ |
| Approve expenses | ✓ | ✓ | own crew | ✗ |
| View all payroll | ✓ | ✓ | ✗ | ✗ |
| Adjust payroll | ✓ | ✓ | ✗ | ✗ |
| Create/void invoices | ✓ | ✓ | ✗ | ✗ |
| Edit org settings | ✓ | ✗ | ✗ | ✗ |
| Read SMTP password | ✗ | ✗ | ✗ | ✗ |
| Own timesheet/leave/expenses | ✓ | ✓ | ✓ | ✓ |
| Read own payslip | — | — | — | own |

## Actual

| Action | "Admin" (= no Staff row) | Finance | Manager | Crew | Unauthenticated |
| --- | :-: | :-: | :-: | :-: | :-: |
| Everything admin | ✓ | **identical — same layout, same check** | **role does not exist** | **✓ via Server Actions** | **✓ — self-register, then admin** |
| Read SMTP password | ✓ | ✓ | — | ✓ via `getSettings()` | ✓ after self-register |
| Read **anyone's** payslip | ✓ | ✓ | — | **✓ via `getCrewLatestPayslip(ref)`** | ✓ after self-register |
| Approve own leave | ✓ | ✓ | — | **✓ via `decideLeaveRequest`** | ✓ |
| Give self a payroll adjustment | ✓ | ✓ | — | **✓ via `addPayrollAdjustment`** | ✓ |

## Gaps

- **Vertical escalation, unauthenticated:** 🔴 sign-up fallthrough → no `Staff` row → admin. One HTTP request.
- **Vertical escalation, authenticated:** 🔴 any crew member invoking `app/actions/admin.ts` directly.
- **Horizontal (IDOR):** 🔴 `getCrewLatestPayslip(staffRef)` — arbitrary staff reference, no auth.
- **Privilege escalation via partial write:** 🔴 if `staff.create` fails inside `addStaffMember`, the `User` and `Account` are already committed with no `Staff` row — the new employee *becomes an admin* and has already been emailed an invite.
- **Finance ≡ Admin:** 🟠 identical checks in both layouts; the separation is cosmetic.
- **No manager tier:** 🟠 approval cannot be scoped to a crew.
- **No self-approval prevention:** 🟠 nothing stops approving your own leave or expenses.
- **Missing separation of duties:** 🟠 the same identity creates, approves and pays an invoice.

---

# 8. Workflow Audit

## Employee lifecycle

```
Current:   [nothing] → Create Staff → (exists forever)
Expected:  Applicant → Onboarding (RTW, PTS, medical, bank, contract)
             → Active → Suspended → Notice → Leaver → Archived (retention)
```
**Missing:** every state after "Active". There is no `endDate`, no leaver status, no final-pay trigger, no access revocation, no document collection, no compliance-expiry tracking. **Invalid transitions:** none possible — there are no transitions. **Notifications:** none. **Audit:** none. For a rail contractor this is the most commercially dangerous gap: expired PTS or medical cards are a safety and regulatory matter, and the system cannot record them at all.

## Leave

```
Current:   Pending → Approved | Rejected     (admin path validates; crew path does not)
Expected:  Draft → Submitted → Manager review → Approved | Rejected | More info
             → Cancelled (by employee, pre-start) → Taken → Reflected in payroll
```
**Missing:** cancellation, amendment, expiry/escalation of stale requests, carry-over at year end, accrual, cover assignment, fit-note attachment for sick leave >7 days, payroll linkage. **Invalid transitions:** approved → approved (re-approvable, `decidedAt` overwritten); rejected → approved with no trace. **Who:** anyone authenticated. **Notifications:** none — an employee is never told the outcome. **Audit:** `decidedAt` only; **never who decided**.

## Timesheet

```
Current:   Employee selects codes → writes directly to Attendance (same rows admin edits)
Expected:  Draft → Submitted → Manager approval → Locked → Feeds payroll
```
**Missing:** the entire approval step. Employee-claimed and manager-verified attendance are the *same rows* with no distinction, no submission timestamp, no lock, and no period close. The "locks after submission" behaviour is React state that vanishes on refresh. Payroll is not derived from attendance at all.

## Expense

```
Current:   Submitted → Approved → Reimbursed | Rejected  (freely replayable in any order)
Expected:  Draft → Submitted → Approved | Rejected(+reason) → Batched → Paid(+ref) → Reconciled
```
**Missing:** withdrawal, rejection reason, approver identity, policy limits, batching, payment reference, reconciliation. **Invalid transitions:** all of them — `decideExpense(id, status)` sets any status from any state with no auth.

## Invoice — the most incomplete lifecycle

```
Current:   Created with an arbitrary status (including `paid`) → never changes
Expected:  Draft → Issued → Sent → Viewed → Partially Paid → Paid
                                          ↘ Overdue → Chased → Written off / Void
```
**Missing:** a `Payment` model (so partial payments cannot exist), sending, overdue automation (`overdue` is a value someone types, never computed from `due < today`), credit notes, void, versioning, chase reminders, aging. An invoice can be created `paid` with no proof, and the `proof` relation has no UI to populate it anywhere in the application.

## Payroll

```
Current:   Zero-value record created at hire → manual adjustments mutate gross in place
Expected:  Period open → Gather attendance + leave + expenses → Calculate → Review
             → Approve → Lock → Pay → Payslips → RTI/HMRC → Close
```
**Missing:** everything except the record. No run, no derivation from attendance, no approval, no lock, no mark-paid, no payslip distribution, no YTD, no statutory submission. `computePay` applies 20% tax / 8% NI / 5% pension and one allowance to every employee regardless of tax code or NI category — **this is not a lawful UK payroll calculation**.

---

# 9. Notification & Event Audit

**Existing: none.** There is no `Notification` model, no email beyond password reset, no in-app inbox, no scheduler. `app/lib/mail.ts` can send, and only the reset flow calls it. Meanwhile `app/lib/settings.json` carries `notifyLeave`, `notifyExpenses`, `notifyPayroll`, `notifyCelebrations` — four toggles that nothing reads.

| Event | Who should know | Channel | Must contain | Action | Status |
| --- | --- | --- | --- | --- | --- |
| Staff invited | New employee | Email | Welcome, set-password link, start date | Set password | 🟡 partial — reset email reused; **failure is swallowed and the API still returns 200** |
| Leave submitted | Approver | Email + in-app | Who, dates, days, balance, clashes | Approve/Reject | ❌ |
| Leave decided | Employee | Email + in-app | Outcome, dates, reason, new balance | View | ❌ **the employee is never told** |
| Leave starting | Employee + crew lead | Email | Dates, cover | — | ❌ |
| Timesheet not submitted | Employee, then manager | Email | Week, days missing | Submit | ❌ |
| Timesheet submitted | Manager | In-app | Employee, week, hours | Approve | ❌ |
| Expense submitted | Approver | Email + in-app | Amount, category, receipt | Approve/Reject | ❌ |
| Expense decided | Employee | Email | Outcome, amount, reason if rejected | View | ❌ |
| Expense reimbursed | Employee | Email | Amount, payment date, reference | — | ❌ |
| Invoice issued/sent | Client + finance | Email | PDF, due date, payment details | Pay | ❌ |
| Invoice overdue | Finance, then client | Email | Days overdue, amount | Chase | ❌ — the state itself is never computed |
| Payment received | Finance | In-app | Amount, invoice, balance | Reconcile | ❌ no payment concept |
| Payroll ready for review | Finance | Email | Period, totals, variances | Approve | ❌ |
| Payslip available | Employee | Email + in-app | Period, net pay, link | View | ❌ |
| **PTS / medical / RTW expiring** | Employee, manager, compliance | Email 90/30/7 days | Document, expiry, renewal steps | Upload | ❌ **safety-critical and structurally impossible — the fields do not exist** |
| Birthday / anniversary | Team | In-app | Name, date | — | 🟡 displayed on a page; never pushed |
| Password changed | Account owner | Email | Time, IP | Report if not you | ❌ |
| Permission/role change | Affected user + admins | Email | Old, new, by whom | — | ❌ no roles exist |
| New sign-in from new device | Account owner | Email | Time, IP, agent | Revoke | ❌ |

**Incorrect recipients / duplicates:** none — nothing is sent. **Missing content and action buttons:** universal.

---

# 10. Bug List

| ID | Bug | Location | Reproduction | Impact | Sev | Fix |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | Failed sign-in silently registers the account | `actions/auth.ts:58-77` | Sign in with any unknown email + any password | **Unauthenticated admin registration** | 🔴 | Delete the fallthrough; return the auth error |
| B2 | Admin = absence of a `Staff` row | `actions/auth.ts:256-262`, `page.tsx:12`, `admin/layout.tsx:22`, `api-auth.ts:19` | Register any email → land on `/admin/dashboard` | Open-by-default privilege | 🔴 | Add `User.role`; check it explicitly |
| B3 | No auth in any `admin.ts` Server Action | `actions/admin.ts` (all exports) | As a crew user, invoke `addPayrollAdjustment` | Full vertical escalation | 🔴 | `requireRole('ADMIN')` at the top of every action |
| B4 | Payslip IDOR | `actions/crew.ts:327-348` | Call `getCrewLatestPayslip('EMP-002')` as EMP-001 | Any user reads any salary | 🔴 | Drop the parameter; derive from session |
| B5 | Hardcoded session secret fallback | `lib/auth.ts:80` | Deploy without `BETTER_AUTH_SECRET` | Forgeable sessions | 🔴 | Throw at boot if unset |
| B6 | Dev mock admin credentials | `actions/auth.ts:107-127` | `NODE_ENV≠production` + unset `GOOGLE_CLIENT_ID` | Unauthenticated admin login | 🔴 | Remove; use a seed script |
| B7 | Crew leave trusts client `days` | `actions/crew.ts:244-273` | POST `days:-1000` or `days:365` | Balance inflation / unlimited leave | 🔴 | Call `createLeaveRequest`'s validation path |
| B8 | Un-transacted staff creation | `actions/admin.ts:816-892` | Create staff with a bad `crewId` | Orphaned User+Account = **a new admin**, invite already sent | 🔴 | Wrap in `$transaction` |
| B9 | `saveSettings` failure returns HTTP 200 `success:true` | `admin.ts:176-179` + `api/admin/settings/route.ts:29-32` | Make the DB write fail | Silent config loss | 🔴 | Throw; let the route map to 500 |
| B10 | Settings POST overwrites the whole file | `admin.ts:151` | POST `{leaveDays:30}` | **Erases every other setting** | 🔴 | Merge; validate; move to DB |
| B11 | SMTP password in plaintext, served to clients | `schema:235`, `admin.ts:124`, `settings-form.tsx:196` | View source on `/admin/settings` | Credential disclosure | 🔴 | Encrypt at rest; never return; write-only field |
| B12 | Admin receipts stored as `blob:` URLs | `expenses-table.tsx:430` | Attach a receipt, reload | **Every admin receipt permanently broken** | 🔴 | Upload to object storage; store the key |
| B13 | Crew receipts stored as base64 in a `String` column | `expense-claims.tsx:40-47` → `crew.ts:294` | Attach a 10 MB photo | ~13 MB rows, re-sent every page load | 🔴 | Same fix as B12; cap size |
| B14 | Negative / `NaN` invoice amounts | `invoices-table.tsx:320`, `admin.ts:1234` | Enter `-500` | Corrupt revenue figures | 🔴 | `min="0.01"`, server check, DB `CHECK` |
| B15 | Invoice creatable as `paid` with no proof | `invoices-table.tsx:333` | Select "Paid" | Fictitious revenue | 🔴 | State machine; require a `Payment` |
| B16 | 5-char `Math.random()` invoice IDs, no retry | `admin.ts:1218` | Create ~1000 invoices | PK collisions on financial documents | 🔴 | `crypto.randomUUID()` or a sequence |
| B17 | Expense ID `EX-${4022 + all.length}` | `expenses-table.tsx:367` | Filter the list, then add | Guaranteed collision | 🔴 | Server-generated ID |
| B18 | Unvalidated attendance codes stored | `api/crew/timesheet/route.ts:37`, `crew.ts:216` | POST `codes:["HACK",1,true,...]` | Garbage in the DB → `NaN` hours | 🔴 | Validate against `ATTENDANCE_CODES` |
| B19 | `NaN` hours on unknown codes | `crew.ts:96` | Follow B18, open the dashboard | Hours render as `null` | 🟠 | `|| 0`, as `admin.ts:210` already does |
| B20 | Crew timesheet has no transaction | `crew.ts:213-235` | Fail mid-week | Partially written week | 🟠 | `$transaction`, as `admin.ts:1012` does |
| B21 | Clearing celebration dates writes `1970-01-01` | `admin.ts:770-772` | Clear both fields, save | Silent corruption, 56-year anniversary | 🟠 | Nullable columns; reject empties |
| B22 | Toast fires before the write, never rolls back | `expenses-table.tsx:129-144`, `payroll-table.tsx:245`, `settings-form.tsx:56`, `celebrations.tsx:137`, `leave-requests.tsx:130` | Kill the network, click Approve | UI shows a success that never happened, permanently | 🟠 | `await` first; revert on error |
| B23 | Payroll adjustment reason is discarded | `payroll-table.tsx` → `admin.ts:455` | Add an adjustment with a reason | No record of why pay changed | 🟠 | `PayrollAdjustment` model |
| B24 | Manual holidays never persist | `manual-holidays.tsx:27` | Add a holiday, reload | Feature is fictional; toast lies | 🟠 | Add a `Holiday` model or remove the panel |
| B25 | `redirect()` inside API routes → 500 `NEXT_REDIRECT` | `crew.ts:47,56` via every `/api/crew/*` | Delete a Staff row mid-session | Nonsense 500s | 🟠 | Return null; let callers decide |
| B26 | Write inside a GET | `crew.ts:60-65` | Two concurrent dashboard loads | Non-idempotent GET, racy | 🟡 | Move the backfill to sign-in |
| B27 | Raw `error.message` to clients everywhere | all 13 `/api` routes | Trigger any Prisma error | Leaks schema, constraint names | 🟠 | Generic message + server log |
| B28 | Client matched case-sensitively | `admin.ts:1221` | Invoice "Network Rail" then "network rail" | Duplicate clients fragment reporting | 🟠 | Normalise; `upsert` |
| B29 | `holiday-filter` `pending` never resets | `holiday-filter.tsx:37` | Change any filter | "Loading…" forever | 🟡 | Reset in an effect |
| B30 | Every input unlabelled in three dialogs | `invoices-table.tsx`, `crews-table.tsx` (Add Crew, Add Staff) | Screen reader | Unusable assistively | 🟠 | `htmlFor`/`id` |
| B31 | Double-submit on 8 forms | crew leave, crew timesheet, crew expenses, Add Crew, Add Staff, New Invoice, add expense, adjustment | Double-click Save | Duplicate records | 🟠 | Disable while pending |
| B32 | `hashPassword` continues after `reject` | `admin.ts:794-801` | scrypt error | Resolves with `undefined` | 🟡 | `return reject(err)` |
| B33 | Dashboard exact-match date filter | `admin.ts:506` | Any row with a time component | "In today" silently reads 0 | 🟠 | Range filter |
| B34 | Local/UTC mixing | `admin.ts:534` vs `:500` | Server west of UTC at a month boundary | Wrong "hired this month" | 🟡 | UTC throughout |
| B35 | `npm run seed:admin` / `seed:demo` don't exist | `README:54-55` vs `package.json:5-10` | Follow the quick start | Setup fails at step 4 | 🟡 | Add the scripts |
| B36 | Frozen `today = '2026-08-25'` still exported | `admin-data.ts:8,346` | Any consumer reading it | Pinned to August 2026 | 🟠 | Delete the mock arrays |
| B37 | Deleting a crew fails with a raw FK error | `schema:87-88` | Try to remove a crew with staff | No crew lifecycle | 🟡 | Nullable `crewId` + soft delete |
| B38 | `Invoice.reference` not unique | `schema:171` | Create two invoices, same reference | Duplicate financial references | 🟠 | `@@unique([clientId, reference])` |

---

# 11. Missing Requirements

**Functional.** Employee offboarding. Employee detail/edit page. Job management and assignment. Client CRUD. Invoice payments, partial payments, sending, void, credit notes. Payroll run, mark-paid, payslip distribution, YTD, P60/P45. Timesheet approval. Leave cancellation, carry-over, accrual. Compliance-document tracking (PTS, medical, right-to-work) with expiry alerts — the single most important domain-specific omission for a rail contractor. Search, filter, sort, pagination, bulk actions, import and export on every list. Reporting.

**Technical.** Prisma migrations. Any automated test (there are none — `scripts/test-*.ts` are connectivity probes). CI. Structured logging. Error monitoring. Health checks. Object storage for files. Background jobs / scheduler. Caching. Connection-pool tuning. `loading.tsx`, `error.tsx`, `global-error.tsx`. Suspense boundaries.

**Security.** Roles and permissions. Authorization in Server Actions. Rate limiting and account lockout. MFA (the settings toggle implies it exists). Session revocation and timeout enforcement. Password policy and history. Secret encryption at rest. CSRF review of Server Actions. Security headers and CSP. File-upload validation and virus scanning. URL scheme allow-listing for attachments. PII encryption. GDPR: retention, export, erasure.

**Database.** Enums. Check constraints. Soft deletes. Audit log. Notification queue. Payment records. `StaffDocument`. Explicit `onDelete` on every relation. Missing indexes (`Session.userId`, `Staff.email`, `Attendance.date`, `PayrollRecord.[year,month]`, `Invoice.due`). Backup and restore procedure. Point-in-time recovery.

**UX.** Loading, error and empty states throughout. Focus traps and focus restore in hand-rolled dialogs. Label association. Confirmation on destructive actions. Unsaved-changes guards beyond `beforeunload`. Mobile admin (currently blocked below `lg`). Keyboard navigation. Screen-reader announcements. Dark-mode parity (admin has it, finance doesn't).

**Operational.** Deployment documentation. Environment validation at boot. Runbooks. Monitoring and alerting. On-call. Data-retention policy. Disaster recovery. Multi-instance readiness (the file-based settings store blocks this).

**Project management.** Ownership and assignment on every entity. Deadlines and SLAs. Escalation. Approval chains and delegation. Audit history. Dashboards and KPIs. Change management for pay rates and policy.

---

# 12. Edge Cases

**Authentication.** Session expires mid-form. Concurrent sessions. Password reset token reuse (no `consumedAt`). Reset requested for a nonexistent user. `Staff` row deleted mid-session (currently a 500). User deleted while holding records. Email changed but `Staff.email` not updated — **the entire role model keys on email, so changing it silently converts an employee into an admin**.

**Leave.** Range spanning a year boundary (balances are year-scoped, the check is not). Range entirely of holidays. Half-day at both ends of a one-day request. Leave submitted for a past date. Overlapping requests submitted concurrently (the clash check is read-then-write). Approval after the dates have passed. Allowance reduced below days already taken. Employee leaves mid-request. Leap day. DST boundary. Scottish vs English bank holidays (handled well — one of the codebase's strengths).

**Attendance.** Two admins editing the same cell simultaneously. Crew submits while an admin is editing. Submission crossing midnight Sunday→Monday (writes the wrong week). Range covering only a weekend (handled ✓). 500-write cap boundary (handled ✓). Attendance for a future date (unblocked). Attendance for a leaver.

**Money.** £0 invoice. Negative invoice (writable). `Number.MAX_SAFE_INTEGER` pence. Rounding on 20%/8%/5% of an odd amount. Currency other than GBP (unsupported, though the setting exists). Payment exceeding the invoice. Refunds. Adjustment driving gross negative. Payroll for a mid-month joiner or leaver. Duplicate invoice reference (permitted).

**Data.** Empty database (the dashboard divides by `prevNetPay`, guarded ✓). Single record. 10,000 staff (every list is unbounded). 100-character names. Unicode and emoji in names and merchants. SQL-injection strings (Prisma parameterises ✓). XSS in `merchant`/`description` (React escapes ✓, but `receipt.url` is rendered as an `href` — **`javascript:` is storable**). Null crew. Staff with no attendance. Staff with no payroll record (the adjustment dialog throws a raw error).

**Infrastructure.** Database unavailable mid-transaction. Nager.Date unreachable (degrades ✓). SMTP unreachable (warns and returns ✓, but callers report success). Concurrent settings writes (last-write-wins, file-based). Disk full during `writeFileSync`. Multiple app instances (settings diverge). Cold start with an empty connection pool.

---

# 13. Production Readiness Score

| Category | Score | Reasoning |
| --- | ---: | --- |
| Architecture | **35**/100 | Sensible Server Component + Action shape, but the security boundary sits on the unused REST path while the used path is open. Three config stores, one of them the source tree. No migrations. Business logic duplicated with divergent behaviour. |
| Frontend | **58**/100 | Genuinely good visual design and two exemplary dialogs. Undercut by zero loading/error boundaries, systematic toast-before-write, eight double-submittable forms, unlabelled inputs in three dialogs, and features that visibly lie (manual holidays, timesheet lock). |
| Backend | **30**/100 | Actions layer is unauthenticated. Almost no input validation. Multi-write flows lack transactions. Raw errors to clients, nothing logged. No pagination. Read-then-write races throughout. The leave and attendance actions are the exception and show what the rest should look like. |
| Database | **32**/100 | Reasonable core shape and correct integer money. But no enums, no check constraints, no soft deletes, no audit, no payments, missing indexes on hot paths, missing `onDelete` policies, a documented model that doesn't exist, and no migration history at all. |
| Security | **8**/100 | Unauthenticated admin registration; unauthenticated privileged actions; payslip IDOR; hardcoded session secret; mock admin credentials; plaintext credentials served to clients; arbitrary JSON written to disk; no rate limiting; no lockout. The scrypt+salt implementation and enumeration-safe reset are the only positives. |
| RBAC | **5**/100 | There is no role system. Authorization is inferred from the absence of a row, and it fails open. Finance and admin are indistinguishable. Crew can invoke every admin action. |
| UX | **60**/100 | Strong information design, thoughtful copy, excellent bulk-entry and leave flows. Held back by absent loading/error states, inconsistent refresh strategies, optimistic updates that never roll back, and accessibility gaps in the hand-rolled dialogs. |
| Reliability | **22**/100 | No tests, no CI, no monitoring, no health checks. Partial writes leave the database inconsistent — one of them grants admin. Failures are reported as successes in at least three places. |
| Performance | **35**/100 | Unbounded `findMany` on every list. Full staff table with three includes loaded to compute a count. Sequential awaits where `Promise.all` applies. Synchronous file I/O in request handlers. Base64 blobs in the database. Missing indexes on the hottest queries. |
| Project Management | **25**/100 | No ownership, deadlines, SLAs, escalation, approval chains, audit history, or reporting. Workflows stop at the first state. Settings toggles promise governance features that don't exist. |
| **Overall** | **28**/100 | A convincing, well-designed prototype. Not a system that can hold real employee, payroll or client data. |

---

# 14. Prioritised Implementation Roadmap

## P0 — Fix Immediately (before this touches any real data)

**P0-1 · Remove the sign-up fallthrough**
*Problem:* `actions/auth.ts:58-77` registers any failed login. *Why it matters:* unauthenticated administrator creation in one request. *Affected:* auth, RBAC, everything. *Solution:* delete the `catch` block; return the original error; add a seed/invite-only path. *Dependencies:* none. *Complexity:* trivial (< 1 hour). *Priority:* immediate.

**P0-2 · Introduce an explicit role model**
*Problem:* admin = absence of a `Staff` row. *Why:* fails open; every bug that skips staff creation grants admin. *Affected:* all. *Solution:* `User.role` enum (`ADMIN|FINANCE|MANAGER|CREW`), default `CREW`; replace `checkIsStaff` at all four call sites; backfill existing rows. *Dependencies:* P0-1, migrations (P1-1). *Complexity:* medium (2–3 days). *Priority:* immediate.

**P0-3 · Authorize every Server Action**
*Problem:* none of the ~20 exports in `actions/admin.ts` check the session. *Why:* full vertical escalation from any authenticated account. *Affected:* staff, leave, expenses, invoices, payroll, settings. *Solution:* a `requireRole(...roles)` helper as the first line of every action, mirroring `getCrewSession()`; add resource-ownership checks; fix the `getCrewLatestPayslip` IDOR by dropping its parameter. *Dependencies:* P0-2. *Complexity:* medium (3–4 days). *Priority:* immediate.

**P0-4 · Remove hardcoded secrets and the mock admin**
*Problem:* `lib/auth.ts:80` secret fallback; `actions/auth.ts:107-127` mock credentials. *Why:* forgeable sessions; unauthenticated admin login on any misconfigured deploy. *Solution:* throw at boot when `BETTER_AUTH_SECRET` is missing; delete the mock path; validate all environment variables at startup with zod. *Dependencies:* none. *Complexity:* trivial (2 hours). *Priority:* immediate.

**P0-5 · Validate every input at the boundary**
*Problem:* negatives, `NaN`, arbitrary enum values and unvalidated URLs reach the database. *Why:* corrupt financial data, `NaN` balances, stored-XSS via `receipt.url`. *Solution:* zod schemas shared by Server Actions and API routes; reuse the existing `ATTENDANCE_CODES` and `isIsoDate` helpers; allow-list URL schemes; add DB `CHECK` constraints as the backstop. *Dependencies:* P1-1. *Complexity:* medium (4–5 days). *Priority:* immediate.

**P0-6 · Wrap multi-write flows in transactions**
*Problem:* `addStaffMember` (4 writes), `addInvoice` (2), `addExpense` (2), `saveCrewTimesheet` (7), `saveSettings` (file + DB). *Why:* the staff case orphans a `User`+`Account` with no `Staff` row — a **privilege escalation via partial write**, with the invite already sent. *Solution:* `prisma.$transaction`, following the pattern already correct at `admin.ts:1012`. *Complexity:* low (1–2 days). *Priority:* immediate.

**P0-7 · Fix credential handling and the settings store**
*Problem:* plaintext SMTP password returned to clients; arbitrary JSON written to the source tree; failures reported as HTTP 200 `success:true`. *Why:* credential disclosure and silent config loss. *Solution:* move settings to a DB table; encrypt secrets at rest; write-only password field; validate and merge rather than replace; throw on failure. *Dependencies:* P1-1. *Complexity:* medium (2–3 days). *Priority:* immediate.

**P0-8 · Fix attachment storage**
*Problem:* admin receipts are `blob:` URLs (broken on reload); crew receipts are multi-MB base64 in a `String` column. *Why:* every admin receipt is already unrecoverable; the crew path will destroy database performance. *Solution:* S3-compatible object storage, presigned uploads, store keys; validate MIME and size; migrate or discard existing rows. *Complexity:* medium (3–4 days). *Priority:* immediate.

## P1 — Required Before Production

**P1-1 · Adopt Prisma migrations** — `db push` makes every schema change below unshippable. Baseline the current schema, remove `generated/` from version control, add `prisma migrate deploy` to the release process. *Blocks most other work.* Low complexity, do it first.

**P1-2 · Add the audit log** — no record of who approved leave, changed pay, or edited settings. `AuditLog` model plus a wrapper on every mutating action. Depends on P0-3. Medium.

**P1-3 · Complete the `Staff` model and build the employee page** — the ~20 HR fields, `StaffDocument`, `/admin/crews/{ref}`, edit and offboard. Without expiry tracking for PTS, medical and right-to-work this system cannot be used by a rail contractor at all. Depends on P1-1. High complexity (1.5–2 weeks).

**P1-4 · Implement the invoice lifecycle** — `Payment` model, partial payments, state machine, computed overdue, void and credit notes, unique reference per client. Depends on P1-1. High (1–1.5 weeks).

**P1-5 · Implement the payroll run** — derive from attendance, review, approve, lock, mark paid; per-employee tax code and NI category; adjustment history. The current flat 20/8/5 calculation is not lawful UK payroll. Depends on P1-3. High (2 weeks).

**P1-6 · Add the timesheet approval workflow** — separate claimed from approved, submission timestamp, period lock, per-day hours. Depends on P1-1. Medium.

**P1-7 · Unify leave logic** — route the crew path through `createLeaveRequest`; delete the duplicate `workingDays()` in the crew form; add cancellation and carry-over. Depends on P0-3. Medium.

**P1-8 · Rate limiting and lockout** — better-auth `rateLimit` config plus per-IP and per-account throttling on sign-in and reset. Low.

**P1-9 · Error handling and observability** — `error.tsx`/`loading.tsx`/`global-error.tsx` per route group, Suspense boundaries, generic client errors with server-side structured logging, error monitoring. Medium.

**P1-10 · Pagination and indexes** — `take`/`skip` and status filters on every list; add the missing indexes on `Session.userId`, `Staff.email`, `Attendance.date`, `PayrollRecord.[year,month]`, `Invoice.due`. Depends on P1-1. Medium.

## P2 — Important

**P2-1 · Notification system** — `Notification` model, email templates, a scheduler for reminders and expiry alerts; wire the four dead settings toggles to real behaviour, starting with leave decisions and compliance expiries. Depends on P1-2. High.

**P2-2 · Complete CRUD** — update and soft delete for every entity; there is currently not one delete operation in the application. Depends on P1-1, P1-2. High.

**P2-3 · Client management** — full CRUD, billing details, VAT, payment terms, contacts; normalise the existing near-duplicate rows created by case-sensitive matching. Medium.

**P2-4 · Fix the optimistic-update pattern** — await the write before the toast, revert on failure, disable submit while pending. Affects eight forms. Low, high user-visible value.

**P2-5 · Accessibility** — focus traps and restore in the two hand-rolled dialogs, `htmlFor`/`id` in the three unlabelled ones, confirmations on destructive actions. Medium.

**P2-6 · Job management** — link `Job` to `Client`, add dates and status, build the assignment UI so `Staff.currentJobId` becomes settable. Medium.

**P2-7 · Manual holidays** — persist them or remove the panel; today it claims success and stores nothing. Low.

**P2-8 · Testing and CI** — unit tests for `computeLeave` and `computePay`, integration tests for authorization on every action, E2E for the core workflows, plus a CI pipeline. High, and it should start alongside P0.

## P3 — Future

**P3-1** Reporting and exports (CSV/PDF, aging, utilisation, cost-per-crew). **P3-2** Mobile admin — remove the `lg` gate. **P3-3** Performance — `Promise.all` on independent queries, caching, connection-pool tuning. **P3-4** Multi-tenancy if more than one operating company is ever needed (retrofitting tenant isolation later is far more expensive than designing for it). **P3-5** HMRC RTI integration. **P3-6** Delete `app/lib/admin-data.ts`'s mock arrays and the frozen `today`/`payPeriod` constants. **P3-7** Fix the README — the HR profile, `StaffDocument`, `/signup`, `seed:admin`/`seed:demo`, and the Server Action security claim are all inaccurate today.

---

**One closing note on the workspace itself.** Your `.env` is correctly gitignored and never committed, but it currently holds a live `GOOGLE_CLIENT_SECRET` in plaintext, and the Prisma Postgres URL I replaced this morning was a live credential that remains in your shell history. Both should be rotated as a matter of routine, and secrets should move to a managed store before any deployment.