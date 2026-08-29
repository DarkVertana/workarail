<div align="center">

<img src="public/logo.svg" alt="Work à Rail" width="640" />

**Workforce operations for rail contractors** — rosters, timesheets, leave, expenses, invoices and payroll in one place.

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

Which portal you land on is decided at sign-in: `/` reads your session and redirects.

---

## Quick start

> **Requirements:** Node 20+, a PostgreSQL 14+ database, and npm.

```bash
# 1. Install
npm install

# 2. Create .env.local with at least DATABASE_URL, APP_URL,
#    NEXT_PUBLIC_APP_URL and BETTER_AUTH_SECRET — see the table below

# 3. Create the schema and the Prisma client
npx prisma db push
npx prisma generate

# 4. Seed a login, then (optionally) a full demo dataset
npm run seed:admin
npm run seed:demo

# 5. Run it
npm run dev
```

Open **http://localhost:3000**. You will be sent to `/signin`.

<details>
<summary><b>Seeded sign-in credentials</b> (development only)</summary>

<br>

| Account | Email | Password | Lands on |
| ------- | ----- | -------- | -------- |
| Admin | `admin@workarail.com` | `Pass1234` | `/admin/dashboard` |
| Any seeded employee | see the roster printed by `seed:demo` | `Pass1234` | `/crew` |

The distinction is not a role column — it is whether a `Staff` row exists for that email.
Change these before deploying anywhere reachable.

</details>

<details>
<summary><b>Environment variables</b></summary>

<br>

| Variable | Required | Purpose |
| -------- | :------: | ------- |
| `DATABASE_URL` | **yes** | PostgreSQL connection string, used by the `pg` pool |
| `APP_URL` | **yes** | Canonical base URL — better-auth base, password-reset links, OAuth redirect |
| `NEXT_PUBLIC_APP_URL` | **yes** | Same URL, exposed to the browser auth client |
| `BETTER_AUTH_SECRET` | **yes** | Session signing secret. Falls back to a hardcoded development string, so *set this in production* |
| `GOOGLE_CLIENT_ID` | no | Google OAuth client. Defaults to `mock`, which enables a dev-only mock login |
| `GOOGLE_CLIENT_SECRET` | no | Google OAuth secret |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` | no | Outbound mail. These are fallbacks — the `SmtpSettings` row set in `/admin/settings` wins |
| `SMTP_FROM` `SMTP_FROM_NAME` | no | Sender identity, defaults to `noreply@workarail.com` / "Work à Rail" |

</details>

---

## Feature tour

<details open>
<summary><b>People and crews</b></summary>

<br>

`/admin/crews` is the roster: avatars, crew and job assignment, status filters. Each
employee has a full HR profile at `/admin/crews/{ref}` covering contact and address details,
emergency contact, employment terms, tax and NI, bank details, government ID and right to
work, plus safety-critical expiries (PTS, medical). One form handles both create and edit;
the employee `ref` becomes read-only once it exists, because everything else keys off it.

</details>

<details open>
<summary><b>Timesheets</b></summary>

<br>

`/admin/timesheets` is a weekly grid, one row per employee, one cell per day, using the
codes `P` present, `H` holiday, `L` late, `A` absent and `-` not scheduled. The entry dialog
marks **many people across a date range in one pass** — useful when a whole crew is rained
off — and it is explicit about the two things that usually go wrong in bulk edits: whether
weekends are included, and whether existing entries get overwritten. A live footer states
exactly how many entries, people, days and hours are about to be written.

Employees submit their own week at `/crew/timesheet`, which locks after submission.

</details>

<details open>
<summary><b>Leave</b></summary>

<br>

`/admin/leaves` is the approval queue. Booking leave on someone's behalf is a four-step
flow — **employee → type → dates → review** — which exists because a leave request is not
one decision but four, and the third depends on the first two.

The maths lives in a single module, `app/lib/leave.ts`, shared by the dialog and the server
action, so the number the admin sees previewed is by construction the number the server
deducts. It:

- counts **working days**, from the configured working pattern, not calendar days;
- skips **public holidays**, region-aware — the late-August UK bank holiday covers England,
  Wales and Northern Ireland but not Scotland, so a global-only holiday filter quietly
  charges staff for bank holidays;
- supports **half days** at either end of a range, so `4.5` is a valid request;
- distinguishes leave types that **deduct from the annual allowance** from those that do not.

Before a request is stored the server re-runs the calculation and independently rejects
requests that overlap existing leave or exceed the remaining allowance. The client-side
preview is a convenience, never the authority. The dialog also warns when crewmates are
already off on those dates, since that is an operational problem rather than a policy one.

</details>

<details>
<summary><b>Expenses, invoices and payroll</b></summary>

<br>

Expense claims and client invoices both carry attachments — receipts, invoice documents,
payment proof — viewed through a shared preview dialog. Payroll runs monthly per employee
with gross, tax, NI, pension and net, supports one-off adjustments, and produces a
printable payslip. **All money is stored in pence as integers**; there are no floats
anywhere in the money path.

</details>

<details>
<summary><b>Settings, holidays and celebrations</b></summary>

<br>

`/admin/settings` covers organisation details, SMTP, and the working pattern that leave
maths depends on. Public holidays come from [Nager.Date](https://date.nager.at), with
Google's public iCal feeds filling in eight countries Nager does not cover (IN, AE, SA, PK,
TH, MY, IL, VN) and a manual entry panel for anywhere still missing. Both sources are
cached for a day and degrade gracefully when unreachable.

`/admin/celebrations` surfaces upcoming birthdays and work anniversaries.

</details>

---

## Architecture

Server Components and Server Actions do the work; there is no separate API layer for the UI
to talk to. The `app/api/*` routes exist for external consumers and are thin JSON wrappers
over the same actions the pages call, so behaviour cannot drift between them.

```
app/
├── page.tsx            # session-based redirect; there is no marketing page
├── signin/ forgot-password/ reset-password/
├── admin/              # operations + HR portal (desktop-only shell)
├── finance/            # money portal, reusing the admin tables
├── crew/               # employee self-service
├── api/
│   ├── auth/[...all]/  # better-auth handler
│   ├── admin/          # stats, staff, settings, payroll, leaves, invoices, expenses, crews
│   └── crew/           # dashboard, timesheet, leave, expenses, payslips
├── actions/
│   ├── auth.ts         # sign in/out, password reset
│   ├── admin.ts        # staff, attendance, leave, expenses, invoices, payroll, analytics
│   └── crew.ts         # self-service equivalents, scoped to the session's own record
├── lib/
│   ├── prisma.ts       # PrismaClient singleton over a pg pool
│   ├── auth.ts         # better-auth: Prisma adapter, scrypt passwords, Google, reset mail
│   ├── api-auth.ts     # getSessionAndRole() — the gate every API route calls
│   ├── leave.ts        # leave policy and working-day maths
│   ├── holidays.ts     # Nager.Date + Google iCal fetching and region filtering
│   ├── mail.ts         # nodemailer, configured from the DB with env fallback
│   └── admin-data.ts   # shared types and pure helpers (see caveats)
└── ui/
    ├── admin/ finance/ crew/
    └── auth-shell.tsx, signin-form.tsx, toast.tsx, logo-mark.tsx, styles.ts
```

### Authentication

[better-auth](https://better-auth.com) with the Prisma adapter, mounted at `/api/auth/*`.
Email and password use scrypt with a per-user salt; password reset sends a real email
through nodemailer. Google sign-in is wired but falls back to a **mock login in
development** when `GOOGLE_CLIENT_ID` is unset.

There is deliberately **no `middleware.ts`**. Every protected area checks the session
server-side in its own layout — `app/admin/layout.tsx`, `app/finance/layout.tsx`,
`app/crew/layout.tsx` — and every API route calls `getSessionAndRole()`. A layout check
alone would not protect Server Actions, so the actions that touch a single employee's data
re-derive that employee from the session rather than trusting an argument.

### Data model

Fifteen Prisma models on PostgreSQL. The connection is supplied at runtime by the `pg`
adapter, which is why the datasource block has no `url`.

| Group | Models |
| ----- | ------ |
| Identity | `User`, `Session`, `Account`, `Verification` |
| Org | `Crew`, `Job`, `Staff`, `StaffDocument` |
| Time | `Attendance` (unique per staff per date), `LeaveRequest` |
| Money | `Client`, `Invoice`, `Expense`, `PayrollRecord`, `Attachment` |
| Config | `SmtpSettings` (single row) |

---

## Scripts

| Command | What it does |
| ------- | ------------ |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and serve |
| `npm run lint` | ESLint |
| `npm run seed:admin` | Creates the admin user and credential account |
| `npm run seed:demo` | Full demo dataset — crews, staff with realistic HR detail, four weeks of attendance, leave, expenses, invoices, payroll. Deterministic, so reruns are stable |

`scripts/` also holds unwired utilities: `clear-db.ts`, `check-db.ts`, `add-dummy-staff.ts`,
and a cluster of `test-*.ts` connectivity probes left over from debugging a DNS problem.
They are not a test suite — there is no automated test coverage yet.

---

## Caveats worth knowing

These are honest known gaps rather than a wishlist:

- **`app/lib/admin-data.ts` is half real, half mock.** Pages read from Prisma now, but this
  file still exports the shared types and pure helpers (`formatMoney`, `computePay`,
  `attendanceHours`) alongside its original hardcoded demo arrays and a fixed
  `today = '2026-08-25'`. The helpers are load-bearing; the fake arrays are not.
- **Admin and finance share one permission level.** There is no role column — access is
  derived solely from whether a `Staff` row exists for the session email, so any non-staff
  user can reach both `/admin/*` and `/finance/*`.
- **No Prisma migrations.** The schema is applied with `db push`, and the generated client
  is committed under `generated/`. Run `npx prisma generate` after pulling schema changes.
- **The admin and finance shells are desktop-only** below the `lg` breakpoint, by design;
  a notice replaces the UI on small screens. The crew portal is responsive.
- **Google sign-in is a development mock** unless real OAuth credentials are configured.
- **`/signup` is linked from the sign-in page but does not exist.** Accounts are created by
  an admin or by the seed scripts.

---

## Contributing

Read `AGENTS.md` first — this repo pins a Next.js version whose conventions differ from
older releases, and the guidance there points at the bundled docs in
`node_modules/next/dist/docs/`. `API_DOC.md` documents the JSON routes.

Two conventions that are easy to trip over:

1. A `'use server'` file may only export async functions. That is why shared types and
   initial state live in `app/lib/auth-state.ts` and `app/lib/leave.ts` rather than beside
   the actions that use them.
2. Anything a client component and a Server Action both need to compute — leave days being
   the clear case — belongs in one shared module, so the preview and the write cannot
   disagree.

## License

[MIT](LICENSE)
