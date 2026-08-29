# Work à Rail — REST API

The JSON routes under `app/api/*` exist for external consumers. The UI itself uses Server
Components and Server Actions directly, and these routes are thin wrappers over **the same
actions**, so behaviour cannot drift between them.

That has one consequence worth stating up front: **authorisation lives in the action, not in
the route.** A route handler never decides who may call it. This is why the roles below are
described per endpoint rather than per path prefix — `/api/admin/*` is not a single
permission level.

---

## Authentication

Every endpoint requires a valid session cookie issued by better-auth at `/api/auth/*`. There
is no API key or bearer token scheme.

### Roles

Authorisation is driven by the `role` column on `User`, not by whether a `Staff` record
exists.

| Role | Scope |
| ---- | ----- |
| `ADMIN` | Everything |
| `FINANCE` | Money: invoices, payments, payroll, expense reimbursement. Reads all staff |
| `MANAGER` | Approvals for **their own crew and direct reports only** |
| `CREW` | Their own records only |

Endpoints requiring an approver (`ADMIN`, `FINANCE`, `MANAGER`) additionally **scope rows by
visibility**. A `MANAGER` calling `GET /api/admin/staff` receives their crew and reports, not
the whole company — the same request returns different row counts for different callers. Do
not treat these lists as complete organisational exports.

---

## Errors

All failures share one shape, produced by `errorResponse` in `app/lib/errors.ts`:

```json
{
  "error": "A message safe to show a user.",
  "code": "validation",
  "details": null
}
```

Internal detail — Prisma messages, stack traces — is logged server-side and never returned.

| Status | Meaning |
| :----: | ------- |
| `400` | The request was understood but rejected: failed validation, or a business rule said no |
| `401` | No valid session |
| `403` | Authenticated, but this role may not do this |
| `404` | Not found **or** not visible to you — the two are deliberately indistinguishable |
| `413` | Upload exceeds 10 MB |
| `422` | Leave submission failed a policy check (overlap, insufficient allowance) |
| `500` | Unexpected. The message is generic by design |

Endpoints backed by actions returning an `ActionResult` report a rejected-but-valid request
as `400` with the message the action chose, rather than a `500`.

---

## Crew endpoints

Require an authenticated employee. Every one resolves the caller **from the session** — none
accepts a staff reference as a parameter, so one employee cannot read another's data by
changing an argument.

### `GET /api/crew/dashboard`

Dashboard payload for the signed-in employee: their own summary, the current attendance
week, leave balance, open claims and latest pay.

`200 OK`

```json
{
  "me": { "ref": "WR-021", "name": "Tomasz Nowak", "role": "Trackman", "email": "tomasz.nowak@workarail.test" },
  "today": "2026-08-28",
  "attendanceWeek": ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"],
  "codes": ["P", "P", "P", "P", "P", "-", "-"],
  "hours": 40,
  "taken": 5,
  "remaining": 23,
  "totalLeaveDays": 28,
  "openClaimsCount": 1,
  "latestPayPence": 250000,
  "payPeriodLabel": "August 2026"
}
```

### `GET /api/crew/timesheet`

The current week only — a subset of the dashboard payload.

`200 OK`

```json
{
  "today": "2026-08-28",
  "attendanceWeek": ["2026-08-24", "…"],
  "codes": ["P", "P", "P", "P", "P", "-", "-"],
  "hours": 40
}
```

### `POST /api/crew/timesheet`

Saves the seven day codes for the current week. Valid codes are `P`, `H`, `L`, `A`, `-`.

```json
{ "codes": ["P", "P", "P", "P", "P", "-", "-"] }
```

`200 OK` → `{ "success": true }`

A week that has been **submitted, approved or locked** can no longer be edited; the action
rejects the write. This matters because payroll reads only approved and locked timesheets.

### `POST /api/crew/leave`

Submits a leave request for the signed-in employee.

```json
{
  "type": "annual",
  "from": "2026-09-01",
  "to": "2026-09-05",
  "reason": "Family holiday",
  "startAt": "afternoon",
  "endAt": "lunchtime"
}
```

`startAt` is `morning` (default) or `afternoon`; `endAt` is `end_of_day` (default) or
`lunchtime`. Together they express half days at either end of a range, so a request can cost
`4.5` days. They are ignored for leave types where the policy does not allow half days.

> **The body does not carry `days`.** The deduction is recomputed server-side from the
> dates, the working pattern and the regional holiday table, so a caller cannot book a
> fortnight and declare it costs half a day. A `days` value in the body is ignored.

`201 Created` returns the stored request, including the server's `days` figure.

```json
{
  "id": "LR-XYZ789",
  "staffRef": "WR-021",
  "type": "annual",
  "from": "2026-09-01T00:00:00.000Z",
  "to": "2026-09-05T00:00:00.000Z",
  "days": 4.5,
  "status": "pending",
  "submitted": "2026-08-28T14:00:00.000Z"
}
```

`422` when the range overlaps existing leave or exceeds the remaining allowance.

### `POST /api/crew/expenses`

Submits an expense claim. Upload any receipt to `POST /api/files` first and pass back the
object that route returned as `receipt`.

```json
{
  "date": "2026-08-25",
  "category": "travel",
  "merchant": "Trainline",
  "description": "Train ticket to depot",
  "amountPence": 4500,
  "vatPence": 0,
  "method": "personal-card",
  "receipt": {
    "name": "receipt.pdf",
    "kind": "pdf",
    "mimeType": "application/pdf",
    "sizeBytes": 106496,
    "storageKey": "2026/08/9f86d0…"
  }
}
```

`date`, `category`, `merchant`, `description`, `amountPence` and `method` are required;
`vatPence` defaults to `0` and `receipt` may be null. All money is **integer pence**.

The `receipt` object is the upload response, not a free-form reference — `mimeType` must be
a PDF or an image and the `storageKey` must correspond to a file that was actually uploaded.
This is what stops a claim pointing at an arbitrary URL.

`201 Created` returns the stored claim with `status: "submitted"`.

### `GET /api/crew/payslips`

The signed-in employee's own payslips, newest first, capped at the most recent 36 periods.
Returns only the fields the payslip view needs — not whole payroll rows.

Only records with status `approved` or `paid` appear. A payroll run still in `draft` is
invisible to the employee, so nobody reads a figure that is still being worked on.

`200 OK`

```json
[
  {
    "id": "pr_01H…",
    "staffRef": "WR-021",
    "year": 2026,
    "month": 8,
    "reference": "AUG26-WR021",
    "grossPence": 300000,
    "taxPence": 35000,
    "niPence": 10000,
    "pensionPence": 5000,
    "netPence": 250000,
    "paidOn": "2026-08-28",
    "status": "paid"
  }
]
```

---

## Admin and finance endpoints

The required role differs per endpoint. Check the badge on each.

### `GET /api/admin/stats` — `ADMIN` `FINANCE` `MANAGER`

Dashboard tiles, computed from live data.

```json
[
  { "label": "Headcount", "value": "44", "delta": "+1", "trend": "up", "positive": true, "hint": "vs last month" }
]
```

### `GET /api/admin/staff` — `ADMIN` `FINANCE` `MANAGER`

The roster, **scoped to what the caller may see** — a `MANAGER` gets their crew and reports,
not the whole company. Archived and soft-deleted staff are excluded.

This is a roster view, not an HR record. Sensitive fields are **never selected by the query**
— NI number, tax code, internal notes, date of birth and bank details do not appear at any
role. There is no endpoint anywhere that returns bank details in a list.

Optional `?week=` accepts seven ISO dates; attendance and utilisation are computed for that
week, defaulting to the current one. Utilisation is measured against the employee's
contracted `weeklyHours`, so it is meaningful for part-time staff.

```json
[
  {
    "ref": "WR-021",
    "name": "Tomasz Nowak",
    "email": "tomasz.nowak@workarail.test",
    "phone": "+447700900077",
    "role": "Trackman",
    "crew": "Track Renewals North",
    "currentJob": "JOB-1042 · Doncaster relay",
    "status": "on-site",
    "employmentStatus": "active",
    "hoursThisWeek": 40,
    "utilization": 100,
    "joined": "2025-01-15",
    "birthday": "1990-05-12"
  }
]
```

Note the two distinct status fields: `status` is day-to-day **availability** (`on-site`,
`off`, `on-leave`), while `employmentStatus` is the **lifecycle** state (`onboarding`,
`active`, `suspended`, `left`, `archived`). They are not interchangeable.

### `POST /api/admin/staff` — `ADMIN`

Creates an employee, their user account and their invitation. The body is validated against
`createStaffSchema` in `app/lib/validation.ts`; it is passed through untouched rather than
being re-checked here, so the route cannot accept a shape the action rejects.

Required: `ref`, `name`, `email`, `phone`, `role`, `joined`. Everything else is optional at
creation.

```json
{
  "ref": "WR-045",
  "name": "John Smith",
  "email": "john.smith@workarail.test",
  "phone": "+447700900088",
  "role": "Driver",
  "joined": "2026-08-28",
  "crewId": "CR-01",
  "employmentStatus": "onboarding",
  "dayRatePence": 22000,
  "payFrequency": "monthly",
  "taxCode": "1257L",
  "taxBasis": "cumulative",
  "niCategory": "A",
  "bank": {
    "accountHolderName": "John Smith",
    "bankName": "Example Bank",
    "method": "bacs",
    "sortCode": "112233",
    "accountNumber": "12345678"
  },
  "documents": [
    {
      "kind": "right_to_work",
      "attachment": {
        "name": "share-code.pdf",
        "kind": "pdf",
        "mimeType": "application/pdf",
        "sizeBytes": 88120,
        "storageKey": "2026/08/1b2c…"
      },
      "expiresOn": "2028-01-01"
    }
  ]
}
```

Two behaviours worth knowing:

- **A tax code creates an effective-dated `StaffPayrollProfile`**, not a column on `Staff`.
- **A submitted bank account is always stored unverified.** Verification is a separate
  privileged action, and payroll will not pay an unverified account.

Setting `employmentStatus` to `active` is **rejected** unless the onboarding requirements in
`app/lib/onboarding.ts` are met — date of birth, address, emergency contact, NI number and
right-to-work evidence. The `400` response names what is missing.

`201 Created` → `{ "ref": "WR-045" }`

### `GET /api/admin/crews` — `ADMIN` `FINANCE` `MANAGER`

```json
[{ "id": "CR-01", "name": "Track Renewals North", "site": "Doncaster" }]
```

### `POST /api/admin/crews` — `ADMIN`

```json
{ "name": "Manchester Depot Crew" }
```

`201 Created` → `{ "id": "CR-02" }`

### `GET /api/admin/leaves` — `ADMIN` `FINANCE` `MANAGER`

All leave requests, newest first, **scoped to the caller's crew** when the caller is a
`MANAGER`.

```json
[
  {
    "id": "LR-1",
    "staffRef": "WR-021",
    "type": "annual",
    "from": "2026-09-01T00:00:00.000Z",
    "to": "2026-09-05T00:00:00.000Z",
    "days": 5,
    "status": "approved",
    "submitted": "2026-08-20T12:00:00.000Z"
  }
]
```

### `GET /api/admin/expenses` — `ADMIN` `FINANCE` `MANAGER`

All expense claims, newest first, scoped the same way.

```json
[
  {
    "id": "EX-1",
    "date": "2026-08-25T00:00:00.000Z",
    "category": "fuel",
    "merchant": "Shell",
    "amountPence": 6000,
    "staffRef": "WR-021",
    "method": "company-card",
    "status": "approved",
    "attachmentId": null
  }
]
```

### `GET /api/admin/invoices` — `ADMIN` `FINANCE`

Invoices with their client and settlement position. `paidPence` is summed from linked
`Payment` rows rather than stored, so "paid" always has payments behind it.

```json
[
  {
    "id": "INV-A1B2C",
    "reference": "INV-2026-001",
    "clientName": "Network Rail",
    "amountPence": 125000,
    "paidPence": 125000,
    "outstandingPence": 0,
    "issued": "2026-08-28T00:00:00.000Z",
    "due": "2026-09-28T00:00:00.000Z",
    "status": "paid"
  }
]
```

### `POST /api/admin/invoices` — `ADMIN` `FINANCE`

Validated against `createInvoiceSchema`. **At least one line item is required and the total is
derived from the lines**, not accepted from the caller — so an invoice total always has
itemisation behind it.

```json
{
  "clientId": "3f1c…-uuid",
  "reference": "INV-2026-002",
  "issued": "2026-08-28",
  "due": "2026-09-28",
  "poNumber": "PO-88213",
  "jobId": "9ab2…-uuid",
  "notes": "Week 34 renewals.",
  "lineItems": [
    {
      "description": "Track renewal — week 34",
      "quantity": 5,
      "unitPricePence": 68000,
      "vatRateBasisPoints": 2000
    }
  ]
}
```

Identify the client by **either `clientId` or `clientName`** — one is required. A name that
does not match an existing client creates one.

`vatRateBasisPoints` is in basis points, so `2000` is 20%, defaulting to the UK standard
rate. `due` must not precede `issued`; the schema rejects it rather than storing an invoice
that is overdue the moment it is created.

`201 Created` → `{ "id": "INV-F3G4H" }`

### `GET /api/admin/payroll` — `ADMIN` `FINANCE`

Payroll records **for the current pay period**, one per employee. This is not a full history;
it is the open run.

```json
[
  {
    "staffRef": "WR-021",
    "grossPence": 350000,
    "taxPence": 42000,
    "niPence": 12000,
    "pensionPence": 6000,
    "netPence": 290000,
    "status": "draft",
    "paidOn": null,
    "reference": "AUG26-WR021",
    "adjustmentCount": 0
  }
]
```

`taxPence` **may be negative.** That is a PAYE refund under cumulative calculation, not a bug
— it happens when earnings drop after tax has already been paid earlier in the year. Clients
must handle it.

Bank details are not present here either. Payroll knows only which account id it paid and
whether it was verified.

### `GET /api/admin/settings` — `ADMIN`

Organisation, leave and SMTP configuration.

**The stored SMTP password is never returned in any form.** It is encrypted at rest and the
response carries only `smtpPasswordSet`, a boolean saying whether one is configured. There is
no read path for the value itself; only the mailer can open it.

```json
{
  "companyName": "Work à Rail Ltd",
  "leaveDays": 28,
  "workingPattern": ["mon", "tue", "wed", "thu", "fri"],
  "holidayRegion": "GB",
  "smtpHost": "smtp.example.com",
  "smtpPort": 587,
  "smtpSecure": false,
  "smtpUser": "postmaster",
  "smtpFrom": "noreply@workarail.com",
  "smtpPasswordSet": true
}
```

### `POST /api/admin/settings` — `ADMIN`

Applies a **patch**, not a replacement. Sending one field no longer blanks the rest. Changes
are audited with before/after values.

```json
{ "leaveDays": 30 }
```

`smtpPass` is write-only, with three distinct meanings:

| Sent as | Effect |
| ------- | ------ |
| omitted | Leave the stored password unchanged |
| `""` | Remove the stored password |
| any other value | Encrypt and store it |

`200 OK` returns the settings as they now stand — again without the password.

### `GET /api/admin/audit` — `ADMIN` only

The audit trail reader: who changed what, when, and from what value to what. Deliberately
admin-only and not offered to `FINANCE` or `MANAGER`, because the trail spans every entity
including payroll and settings and is not crew-scoped. There is no UI — paste the URL in a
browser.

| Parameter | Meaning |
| --------- | ------- |
| `entity` | Model name, e.g. `Invoice`, `Staff`, `PayrollRecord`, `Setting` |
| `entityId` | A specific record id |
| `action` | One of the `AuditAction` values; an unknown value returns `400` with the allowed list |
| `actor` | Actor email, exact match |
| `from`, `to` | Business dates `YYYY-MM-DD`, inclusive of the whole final day |
| `take` | 1–500, default 100 |
| `cursor` | Id of the last row from the previous page |
| `format` | `json` (default) or `csv` |

```
GET /api/admin/audit?entity=Invoice&entityId=INV-0042
GET /api/admin/audit?action=role_change&take=100
GET /api/admin/audit?actor=priya.raman@workarail.test&from=2026-08-01&to=2026-08-31
GET /api/admin/audit?format=csv
```

```json
{
  "count": 100,
  "hasMore": true,
  "nextCursor": "aud_01H…",
  "filters": { "entity": "Invoice", "entityId": null, "action": null, "actor": null, "from": null, "to": null },
  "entries": [
    {
      "id": "aud_01H…",
      "createdAt": "2026-08-28T14:02:11.000Z",
      "actorEmail": "priya.raman@workarail.test",
      "action": "update",
      "entity": "Invoice",
      "entityId": "INV-0042",
      "summary": "Marked paid",
      "before": { "status": "issued" },
      "after": { "status": "paid" },
      "ipAddress": "10.0.0.4"
    }
  ]
}
```

`before` and `after` are **scrubbed when written** — credentials and payroll identity never
enter the trail, so bank and tax values cannot be recovered from it. The route returns them
as stored rather than filtering again. Responses are `Cache-Control: private, no-store`.

---

## Files

### `POST /api/files` — any authenticated user

Multipart upload. Returns the reference a form submits alongside its other fields. Splitting
upload from record creation keeps multipart bodies out of Server Actions and means a rejected
expense claim does not silently discard the receipt.

```
POST /api/files
Content-Type: multipart/form-data

file: <binary>
```

Maximum 10 MB; larger uploads get `413`. Keys are content-addressed, so re-uploading an
identical file is idempotent and reuses the existing row.

`201 Created`

```json
{
  "id": "att_01H…",
  "name": "receipt.pdf",
  "kind": "pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 106496,
  "storageKey": "2026/08/9f86d0…"
}
```

Any signed-in user may upload. What they may then *attach it to* is enforced by the action
that consumes the key.

### `GET /api/files/{storageKey}` — ownership-checked

Streams an attachment back. Every read costs an ownership check: `CREW` see their own
receipts and documents, `MANAGER` see their crew's, `ADMIN` and `FINANCE` see everything.

A file that exists but is not yours returns **`404`, not `403`** — the two are
indistinguishable on purpose, so the route cannot be used to probe which receipts exist.

Responses carry `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src
'none'; sandbox` and `Cache-Control: private`, so a stored upload cannot execute in our
origin and is never cached by a shared proxy.

---

## What has no endpoint, and why

Some capabilities exist as Server Actions with **no HTTP route deliberately**:

- **Bank details.** `app/actions/bank.ts` handles reads, writes and verification. Full
  decryption happens only in `resolvePaymentInstruction` (admin-only), which writes a
  `view_sensitive` audit entry on every call. Exposing this over HTTP would create exactly
  the enumerable endpoint the encryption exists to make pointless.
- **Approvals and state transitions** — leave decisions, expense reimbursement, payroll
  approval, invoice issue and payment. These have preconditions and side effects (audit
  entries, notifications, immutability) that a generic REST verb would invite callers to
  skip.
- **Payroll runs.** `runPayroll` refuses employees without a tax code or a verified bank
  account and reports them as problems rather than failing silently. It is driven from the
  payroll page.

If you need any of these over HTTP, add a route that calls the existing action. Do not
reimplement the logic in the handler — the point of the thin-wrapper pattern is that there
is one place where each rule lives.
