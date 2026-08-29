<div align="center">

<img src="public/logo.svg" alt="Work à Rail" width="640" />

**Workforce operations for rail contractors** — rosters, timesheets, leave, expenses, invoices and UK payroll in one place.

[![Next.js](https://img.shields.io/badge/Next.js-16.3-000000?logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-087EA4?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?logo=prisma&logoColor=white)](https://www.prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![License](https://img.shields.io/badge/License-MIT-22C55E)](LICENSE)

</div>

---

## What this is

Work à Rail is an internal operations app for a rail contracting business. It answers the
questions that come up every week on a labour-supply job: who is on which crew, who turned
up, who is off and whether they can afford to be, what got spent, what got invoiced, and
what everyone is owed at the end of the month.

It ships as **three portals over one database**, so nobody has to reconcile spreadsheets:

| Portal | Who it is for | What they can do |
| ------ | ------------- | ---------------- |
| **Admin** `/admin` | Operations and HR | Full roster and HR records, attendance, leave decisions, expenses, invoices, payroll, org settings |
| **Finance** `/finance` | Finance | The money views — invoices, expenses, payroll, analytics — plus the attendance and leave that drive payroll cost |
| **Crew** `/crew` | Employees | Self-service: submit your own timesheet, request leave, claim expenses, read your payslip |

Which portal you land on is decided at sign-in: `/` reads your session and redirects
according to the role on the `User` record.

---

## Quick start

> **Requirements:** Node 20+, a PostgreSQL 14+ database, and npm.

```bash
# 1. Install
npm install

# 2. Copy the environment template and fill in the four required values
cp .env.example .env
#    Generate the two secrets with: openssl rand -base64 32

# 3. Apply migrations and generate the Prisma client
npm run db:migrate
npm run db:generate

# 4. Seed a realistic development dataset
npm run db:seed

# 5. Run it
npm run dev
```

Open **http://localhost:3000**. You will be sent to `/signin`.

The app **refuses to start** if a required environment variable is missing, too short, or
set to a well-known placeholder. That is deliberate — a silent fallback secret makes every
session forgeable.

<details>
<summary><b>Seeded sign-in credentials</b> (development only)</summary>

<br>

Every seeded account shares the password `Workarail-Dev-2026`.

| Role | Email | Lands on |
| ---- | ----- | -------- |
| `ADMIN` | `priya.raman@workarail.test` | `/admin` |
| `FINANCE` | `daniel.okafor@workarail.test` | `/finance` |
| `MANAGER` | `gareth.lloyd@workarail.test` (Track Renewals North) | `/admin` |
| `MANAGER` | `marta.kowalczyk@workarail.test` (Signalling South) | `/admin` |
| `CREW` | `tomasz.nowak@workarail.test` | `/crew` |

The seed prints the full roster when it finishes. All of it is synthetic — no real personal,
bank or payroll data appears in any seed file.

</details>

<details>
<summary><b>Environment variables</b></summary>

<br>

| Variable | Required | Purpose |
| -------- | :------: | ------- |
| `DATABASE_URL` | **yes** | PostgreSQL connection string, used by the `pg` pool |
| `APP_URL` | **yes** | Canonical base URL — better-auth base, password-reset links, OAuth redirect |
| `BETTER_AUTH_SECRET` | **yes** | Session signing secret. Minimum 32 characters; placeholders are rejected |
| `SECRET_ENCRYPTION_KEY` | **yes** | Encrypts secrets at rest — employee bank details and the stored SMTP password. Minimum 32 characters. **Losing this makes existing bank records unreadable** |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | no | Google OAuth. Must be set together or not at all |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | no | Outbound mail fallbacks — the settings stored in `/admin/settings` win |
| `SMTP_FROM` `SMTP_FROM_NAME` | no | Sender identity |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | no | Bootstraps the first administrator via `npm run seed:admin`, since public sign-up is disabled |

</details>

---

## Feature tour

<details open>
<summary><b>People, crews and onboarding</b></summary>

<br>

`/admin/crews` is the roster: avatars, crew and job assignment, status filters. New
employees are added at `/admin/crews/new`, a sectioned form covering identity, contact and
address, employment terms, payroll, bank details, compliance documents and internal notes.

Only employee ID, legal name, work email, work phone, trade and start date are required to
create a record — a half-finished profile is more useful than a blocked one. The gate sits
on the **status transition** instead: `app/lib/onboarding.ts` defines what "complete" means,
and an employee cannot be made `active` while missing date of birth, address, emergency
contact, NI number or right-to-work evidence.

</details>

<details open>
<summary><b>Timesheets</b></summary>

<br>

`/admin/timesheets` is a weekly grid, one row per employee, one cell per day, using the
codes `P` present, `H` holiday, `L` late, `A` absent and `-` not scheduled. The entry dialog
marks **many people across a date range in one pass** — useful when a whole crew is rained
off — and it is explicit about the two things that usually go wrong in bulk edits: whether
weekends are included, and whether existing entries get overwritten.

Employees submit their own week at `/crew/timesheet`. Payroll only counts attendance on a
timesheet that has been **approved or locked**, so pay can never be generated from figures
the employee could still change.

</details>

<details open>
<summary><b>Leave</b></summary>

<br>

`/admin/leaves` is the approval queue. Booking leave on someone's behalf is a four-step
flow — **employee → type → dates → review** — because a leave request is not one decision
but four, and the third depends on the first two.

The maths lives in a single module, `app/lib/leave.ts`, shared by the dialog and the server
action, so the number the admin sees previewed is by construction the number the server
deducts. It:

- counts **working days**, from the configured working pattern, not calendar days;
- skips **public holidays**, region-aware — the late-August UK bank holiday covers England,
  Wales and Northern Ireland but not Scotland, so a global-only filter quietly charges
  Scottish staff for a bank holiday;
- supports **half days** at either end of a range, so `4.5` is a valid request;
- distinguishes leave types that **deduct from the annual allowance** from those that do not.

Before a request is stored the server re-runs the calculation and independently rejects
requests that overlap existing leave or exceed the remaining allowance. The client-side
preview is a convenience, never the authority.

</details>

<details open>
<summary><b>Payroll — real HMRC PAYE</b></summary>

<br>

Payroll is **not** a flat percentage of gross. `app/lib/hmrc/` implements the calculation
properly:

- `tax-years.ts` holds income tax bands (UK, Scottish and Welsh regimes), NI thresholds and
  category rates, and student loan thresholds — **all keyed by tax year**, so nothing is a
  magic number scattered through the code.
- `tax-code.ts` parses codes as HMRC defines them: `L`/`M`/`N` suffixes, `BR`/`D0`/`D1`,
  `K` prefixes, `NT`, the `S` and `C` regime prefixes, and the week-1/month-1 marker.
- `index.ts` runs **cumulative PAYE** from year-to-date figures, including the regulatory
  50% overriding limit on K codes, plus NI and student loan deductions.

An employee's tax code lives in `StaffPayrollProfile` and is **effective-dated**. A code
that changes mid-year closes the old row and opens a new one, so historical payslips do not
move. Each `PayrollRecord` also stores the tax code, basis, period and YTD snapshot it was
calculated from, which is what makes `npm run db:verify-payroll` meaningful — it recomputes
every stored record from its own recorded inputs and asserts they match.

Cumulative PAYE can legitimately produce a **negative tax figure** when earnings drop: that
is a refund, and the database constraints permit it within bounds while still requiring net
pay to reconcile exactly against gross minus every deduction.

Payroll refuses to run for an employee with no tax code, or with no verified bank account,
rather than guessing. All money is stored as **integer pence**; there are no floats in the
money path.

> **Scope limit.** This covers PAYE, National Insurance (categories A, B, C, H, M, Z),
> student and postgraduate loans. It does **not** implement RTI submission to HMRC,
> statutory pay (SSP/SMP/SPP), pension auto-enrolment assessment, or the Employment
> Allowance. Those are absent rather than approximated.

</details>

<details open>
<summary><b>Bank details</b></summary>

<br>

Employee bank details are a separate `StaffBankAccount` entity rather than columns on
`Staff`, because accounts change, need effective dates, and payroll must record *which*
account it paid.

Account number, sort code, IBAN and BIC are **AES-256-GCM encrypted at rest**. Only the last
four digits of the account and last two of the sort code are stored in clear, for display.
Reads are restricted to `ADMIN` and `FINANCE`; full decryption happens in exactly one place
(`resolvePaymentInstruction`, admin-only) and writes a `view_sensitive` audit entry every
time. New accounts are always created unverified — verification is a separate action.

</details>

<details>
<summary><b>Expenses, invoices and documents</b></summary>

<br>

Expense claims and client invoices both carry attachments — receipts, invoice documents,
payment proof. Files are stored on disk under `var/uploads/` with content-addressed keys and
served through `/api/files/{key}`, which performs an **ownership check on every read**: staff
see their own documents, managers see their crew, finance and admin see everything. Files
are served with `nosniff` and a sandboxing CSP so a stored upload cannot execute in our
origin.

</details>

<details>
<summary><b>Settings, holidays and celebrations</b></summary>

<br>

`/admin/settings` covers organisation details, SMTP, and the working pattern that leave
maths depends on. Settings live in the `Setting` table and changes are audited. Public
holidays come from [Nager.Date](https://date.nager.at), with Google's public iCal feeds
filling in countries Nager does not cover, cached for a day and degrading gracefully when
unreachable. `/admin/celebrations` surfaces upcoming birthdays and work anniversaries.

</details>

---

## Architecture

Server Components and Server Actions do the work. The `app/api/*` routes exist for external
consumers and are thin JSON wrappers over the same actions the pages call, so behaviour
cannot drift between them. See **[`API_DOC.md`](API_DOC.md)** for the endpoint reference.

```
app/
├── page.tsx            # session-based redirect; there is no marketing page
├── admin/ finance/ crew/   # the three portals
├── api/
│   ├── auth/[...all]/  # better-auth handler
│   ├── admin/          # stats, staff, settings, payroll, leaves, invoices, expenses, crews, audit
│   ├── crew/           # dashboard, timesheet, leave, expenses, payslips
│   └── files/          # authenticated upload and download
├── actions/            # admin, crew, staff, payroll, bank, invoices, documents, notifications, auth
└── lib/
    ├── authz.ts        # roles, scoping, field redaction — the single authorisation source
    ├── env.ts          # fail-fast environment validation
    ├── errors.ts       # AppError, safe HTTP mapping, ActionResult
    ├── validation.ts   # every Zod schema
    ├── audit.ts        # audit writes, with sensitive-key scrubbing
    ├── hmrc/           # tax years, tax-code parsing, PAYE/NI engine
    ├── bank.ts         # bank encryption, validation, masking
    ├── onboarding.ts   # what "complete enough to activate" means
    ├── leave.ts        # leave policy and working-day maths
    ├── dates.ts        # business dates vs UTC timestamps
    └── storage.ts      # attachment storage
```

### Authentication and authorisation

[better-auth](https://better-auth.com) with the Prisma adapter, mounted at `/api/auth/*`.
Passwords use scrypt with a per-user salt.

Authorisation is a real **role column** on `User` — `ADMIN`, `FINANCE`, `MANAGER`, `CREW` —
not an inference from whether a staff record exists. `app/lib/authz.ts` is the only place
that decides anything:

| Helper | Admits |
| ------ | ------ |
| `requireAdmin()` | `ADMIN` |
| `requireFinance()` | `ADMIN`, `FINANCE` |
| `requireApprover()` | `ADMIN`, `FINANCE`, `MANAGER` |
| `requireStaff()` | any signed-in employee, returns their own record |
| `visibleStaffRefs(actor)` | the refs this actor may see — own for `CREW`, crew and reports for `MANAGER`, all for `ADMIN`/`FINANCE` |

There is deliberately **no `middleware.ts`**. A layout check would not protect Server
Actions, so every action authorises itself and re-derives the employee from the session
rather than trusting an argument. `visibleStaffRefs` must be applied by every list of people
or of records belonging to people.

### Data model

25 Prisma models on PostgreSQL, managed with **Prisma Migrate**. The connection is supplied
at runtime by the `pg` adapter, which is why the datasource block has no `url`.

| Group | Models |
| ----- | ------ |
| Identity | `User`, `Session`, `Account`, `Verification` |
| Org | `Crew`, `Job`, `Staff`, `StaffDocument` |
| Payroll identity | `StaffPayRate`, `StaffPayrollProfile`, `StaffBankAccount` |
| Time | `Timesheet`, `Attendance`, `LeaveRequest` |
| Money | `Client`, `Invoice`, `InvoiceLineItem`, `Payment`, `Expense`, `PayrollRecord`, `PayrollAdjustment` |
| Platform | `Attachment`, `Setting`, `AuditLog`, `Notification` |

Business rules are enforced in the database as well as the application: CHECK constraints on
money reconciliation, partial unique indexes (one primary bank account per employee, one
attendance row per person per day), and `onDelete: Restrict` on anything financial.
`npm run db:check` asserts the integrity invariants.

---

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run verify` | **Typecheck, lint and tests** — run this before pushing |
| `npm run typecheck` / `npm run lint` / `npm test` | The pieces individually |
| `npm run db:migrate` | Apply migrations (`prisma migrate deploy`) |
| `npm run db:generate` | Regenerate the Prisma client |
| `npm run db:seed` | Full synthetic dataset — 44 staff, crews, jobs, attendance, leave, expenses, invoices, payroll. Deterministic |
| `npm run db:reset` | Clear operational data, respecting foreign-key order |
| `npm run db:refresh` | `db:reset` then `db:seed` |
| `npm run db:audit` | **Integrity + payroll reproduction + sensitive-data checks** |
| `npm run db:check` | Integrity invariants only |
| `npm run db:verify-payroll` | Recomputes every payroll record from its stored inputs |
| `npm run db:verify-sensitive` | Asserts bank data is encrypted and absent from audit logs |
| `npm run db:inventory` | Row counts per table |
| `npm run seed:admin` | Creates a single admin user, without the full dataset |

Tests are [Vitest](https://vitest.dev) under `tests/`, covering the HMRC engine, bank
encryption, onboarding rules, validation schemas, invoices, storage and environment
handling.

---

## Caveats worth knowing

These are honest known gaps rather than a wishlist:

- **Payroll is not RTI-connected.** See the scope limit in the payroll section above.
- **The admin and finance shells are desktop-only** below the `lg` breakpoint, by design; a
  notice replaces the UI on small screens. The crew portal is responsive.
- **Google sign-in is optional** and disabled unless both credentials are configured.
- **Accounts are created by an admin or the seed**, not by self-service signup.
- **Attachment storage is the local filesystem** (`var/uploads/`). That is fine for a single
  host; a multi-instance deployment needs `app/lib/storage.ts` pointed at object storage.
- **No CI pipeline yet.** `npm run verify` and `npm run db:audit` are the gates, but nothing
  enforces them automatically on push.

---

## Contributing

Read `AGENTS.md` first — this repo pins a Next.js version whose conventions differ from
older releases, and the guidance there points at the bundled docs in
`node_modules/next/dist/docs/`.

Conventions that are easy to trip over:

1. A `'use server'` file may only export async functions. Shared types and initial state
   live in `app/lib/*` rather than beside the actions that use them.
2. Anything a client component and a Server Action both need to compute — leave days being
   the clear case — belongs in one shared module, so the preview and the write cannot
   disagree.
3. Authorisation belongs in the action, never in the route handler or the layout alone.
4. Money is integer pence. Business dates and UTC timestamps are different things; use
   `app/lib/dates.ts`.

---

## License

[MIT](LICENSE)
