/**
 * Server-side input validation.
 *
 * Browser validation is a convenience; this is the boundary that decides what
 * is allowed to reach the database. Every Server Action and API route parses
 * its input through one of these schemas, so the two interfaces cannot drift
 * apart in what they accept.
 *
 * The database CHECK constraints added in the integrity migration remain the
 * final backstop: anything that slips past here still cannot be stored.
 */

import { z } from 'zod'
import { AppError } from './errors'

// --- primitives -------------------------------------------------------------

/** Money is always integer minor units. Rejects NaN, Infinity and fractions. */
export const pence = z
  .number()
  .int('Amounts must be a whole number of pence.')
  .finite()
  .min(0, 'Amounts cannot be negative.')
  .max(1_000_000_000_00, 'That amount is implausibly large.')

export const positivePence = pence.gt(0, 'Enter an amount greater than zero.')

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'That is not a real date.')

export const shortText = z.string().trim().min(1, 'This is required.').max(200)
export const longText = z.string().trim().max(2000)
export const email = z.string().trim().toLowerCase().email('Enter a valid email address.')

/** Employee reference, e.g. EMP-001. */
export const staffRef = z
  .string()
  .trim()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,23}$/i, 'That is not a valid employee reference.')

export const attendanceCode = z.enum(['P', 'H', 'L', 'A', '-'])

export const leaveType = z.enum([
  'annual',
  'sick',
  'unpaid',
  'parental',
  'compassionate',
])

export const expenseCategory = z.enum([
  'travel',
  'materials',
  'equipment',
  'meals',
  'training',
  'other',
])

export const expenseMethod = z.enum(['company_card', 'personal', 'cash'])

export const userRole = z.enum(['ADMIN', 'FINANCE', 'MANAGER', 'CREW'])

export const employmentStatus = z.enum([
  'onboarding',
  'active',
  'suspended',
  'notice',
  'leaver',
  'archived',
])

export const availability = z.enum(['on_site', 'available', 'off_shift'])

/**
 * Attachment references. Only keys produced by our own storage layer are
 * accepted — a client-supplied `javascript:` or `data:` URL can no longer
 * become a clickable resource.
 */
export const attachmentInput = z.object({
  name: shortText,
  kind: z.enum(['pdf', 'image']),
  mimeType: z
    .string()
    .regex(/^(application\/pdf|image\/(png|jpeg|jpg|webp|gif))$/, 'Unsupported file type.'),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024, 'Files must be 10 MB or smaller.'),
  storageKey: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9/_-]{8,200}$/,
      'Invalid storage reference.'
    ),
})

// --- cross-field helpers ----------------------------------------------------

/** `to` must not precede `from`. */
const orderedRange = <T extends { from: string; to: string }>(schema: z.ZodType<T>) =>
  schema.refine((v) => v.to >= v.from, {
    message: 'The end date is before the start date.',
    path: ['to'],
  })

// --- domain schemas ---------------------------------------------------------

/** HMRC NI table letters. Anything else is a data-entry error. */
export const niCategory = z.enum([
  'A', 'B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'S', 'V', 'X', 'Z',
])

export const createStaffSchema = z.object({
  ref: staffRef,
  /** Legal name — must match the contract, payslip and right-to-work check. */
  name: shortText,
  /** What colleagues call them. Optional; the roster falls back to `name`. */
  preferredName: z.string().trim().max(120).optional(),
  email,
  phone: z.string().trim().max(30).optional().default(''),
  /**
   * Personal contact details. Optional at creation but needed before an
   * employee leaves, since a P45 has to reach them after their work account
   * is closed.
   */
  personalEmail: z.string().trim().email('Enter a valid email.').optional().or(z.literal('')),
  personalPhone: z.string().trim().max(30).optional(),
  gender: z
    .enum(['male', 'female', 'non_binary', 'prefer_not_to_say'])
    .default('prefer_not_to_say'),
  nationality: z.string().trim().max(60).optional(),
  /**
   * Full date of birth. Required rather than optional: it determines the NI
   * category (under 21 and over state pension age are rated differently) and
   * Network Rail medicals are age-banded, so payroll and compliance both
   * depend on it.
   */
  dateOfBirth: isoDate.optional(),
  addressCountry: z.string().trim().max(60).optional(),
  /** HR-only free text. Never shown to the employee. */
  internalNotes: z.string().trim().max(2000).optional(),
  payFrequency: z
    .enum(['weekly', 'fortnightly', 'four_weekly', 'monthly'])
    .default('monthly'),
  role: shortText,
  /** Contractual title for the contract and payslip; distinct from trade. */
  jobTitle: z.string().trim().max(120).optional(),
  /**
   * Empty string is coerced to null so an unselected crew dropdown does not
   * fail uuid validation and reject the whole submission — the form was
   * posting `crewId: ''` and the save silently failed.
   */
  crewId: z
    .union([z.literal(''), z.string().uuid('Select a crew.')])
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional(),
  availability: availability.default('off_shift'),
  employmentStatus: employmentStatus.default('active'),
  contractType: z
    .enum(['permanent', 'fixed_term', 'agency', 'subcontractor', 'apprentice'])
    .default('permanent'),
  joined: isoDate,
  /** 'MM-DD'; the birth year is deliberately not collected here. */
  birthday: z
    .string()
    .regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use the format MM-DD.')
    .nullable()
    .optional(),
  /** End of probation, where one applies. */
  probationEndDate: isoDate.nullable().optional(),
  weeklyHours: z.number().positive().max(80).default(37.5),
  dayRatePence: pence.nullable().optional(),
  managerRef: staffRef.nullable().optional(),
  /**
   * Per-employee annual leave entitlement. Null falls back to the
   * organisation default, pro-rated from `weeklyHours` and the join date.
   */
  annualLeaveDays: z.number().min(0).max(365).nullable().optional(),
  carryOverDays: z.number().min(0).max(365).default(0),
  addressLine1: z.string().trim().max(200).optional(),
  addressLine2: z.string().trim().max(200).optional(),
  addressCity: z.string().trim().max(100).optional(),
  addressPostcode: z.string().trim().max(12).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(30).optional(),
  emergencyContactRelation: z.string().trim().max(60).optional(),
  /**
   * NI number, shape-checked against HMRC's format: two letters (excluding
   * the combinations HMRC never issues), six digits, then a letter A-D. The
   * previous pattern accepted any two letters, so typos like "QQ" passed.
   */
  niNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/,
      'Enter a valid National Insurance number, like AB123456C.'
    )
    .optional()
    .or(z.literal('')),
  /**
   * PAYE arrangement at the point of hire. Optional here because a new starter
   * without a P45 legitimately has no code yet — payroll refuses to pay them
   * until one is recorded, rather than the form refusing to create them.
   *
   * Stored as the first `StaffPayrollProfile` row, not as columns on Staff, so
   * a later code change supersedes rather than overwrites it.
   */
  taxCode: z
    .string()
    .trim()
    .max(10)
    .regex(/^[A-Za-z0-9 ]+$/, 'A tax code is letters and digits only.')
    .optional()
    .or(z.literal('')),
  taxBasis: z.enum(['cumulative', 'week1_month1']).default('cumulative'),
  niCategory: niCategory.default('A'),
  studentLoanPlan: z
    .union([z.literal(1), z.literal(2), z.literal(4), z.literal(5)])
    .nullable()
    .optional(),
  postgradLoan: z.boolean().default(false),
  /**
   * Bank details captured during onboarding, created as the employee's first
   * `StaffBankAccount`. Optional: someone can start work before payment
   * details are known, and payroll refuses to pay them until they are.
   *
   * Always created UNVERIFIED. Verification is a separate action performed by
   * a different person, which is the control against payroll redirection
   * fraud.
   */
  bank: z
    .object({
      accountHolderName: shortText,
      bankName: z.string().trim().max(120).optional(),
      method: z.enum(['bacs', 'international']).default('bacs'),
      sortCode: z.string().trim().max(10).optional(),
      accountNumber: z.string().trim().max(12).optional(),
      iban: z.string().trim().max(40).optional(),
      bic: z.string().trim().max(11).optional(),
    })
    .optional(),

  /** Compliance and identity documents attached at onboarding. */
  documents: z
    .array(
      z.object({
        kind: z.enum([
          'pts', 'medical', 'right_to_work', 'contract', 'certification',
          'government_id', 'tax_document', 'ni_evidence', 'other',
        ]),
        attachment: attachmentInput,
        reference: z.string().trim().max(60).optional(),
        issuedOn: isoDate.optional(),
        expiresOn: isoDate.optional(),
      })
    )
    .max(20)
    .optional(),

  /** The access level the invited login is created with. */
  userRole: userRole.default('CREW'),
})

export const updateStaffSchema = createStaffSchema
  .partial()
  .omit({ ref: true, email: true })

/**
 * A UK bank account, or an international one.
 *
 * The account number and sort code are validated for shape here and normalised
 * (and encrypted) in `app/lib/bank.ts`. Shape validation cannot prove an
 * account exists — that is what the separate verification step is for.
 */
export const bankAccountSchema = z
  .object({
    staffRef,
    accountHolderName: shortText,
    bankName: z.string().trim().max(120).optional(),
    method: z.enum(['bacs', 'international']).default('bacs'),
    /** Six digits, however the user chose to punctuate them. */
    sortCode: z
      .string()
      .trim()
      .regex(/^[\d\s-]{6,10}$/, 'A sort code is six digits, like 12-34-56.')
      .optional(),
    accountNumber: z
      .string()
      .trim()
      .regex(/^[\d\s-]{6,12}$/, 'An account number is eight digits.')
      .optional(),
    iban: z.string().trim().max(40).optional(),
    bic: z.string().trim().max(11).optional(),
    isPrimary: z.boolean().default(true),
    effectiveFrom: isoDate,
  })
  .superRefine((value, ctx) => {
    // Conditionally required: which fields matter depends on the method, and
    // a half-filled account is worse than none because payroll would try it.
    if (value.method === 'bacs') {
      if (!value.sortCode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['sortCode'],
          message: 'A UK account needs a sort code.',
        })
      }
      if (!value.accountNumber) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['accountNumber'],
          message: 'A UK account needs an account number.',
        })
      }
    } else if (!value.iban) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['iban'],
        message: 'An international payment needs an IBAN.',
      })
    }
  })

/**
 * A PAYE arrangement effective from a date.
 *
 * The tax code is only shape-checked here; `parseTaxCode` in the action does
 * the authoritative check, because knowing whether "1257L" is operable is the
 * payroll engine's job rather than the form's.
 */
export const payrollProfileSchema = z.object({
  staffRef,
  taxCode: z
    .string()
    .trim()
    .min(2)
    .max(10)
    .regex(/^[A-Za-z0-9 ]+$/, 'A tax code is letters and digits only.'),
  basis: z.enum(['cumulative', 'week1_month1']).default('cumulative'),
  niCategory: niCategory.default('A'),
  /** Plans 1, 2, 4 and 5 are the ones collectable through PAYE. */
  studentLoanPlan: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(5)])
    .nullable()
    .optional(),
  postgradLoan: z.boolean().default(false),
  effectiveFrom: isoDate,
  source: z.string().trim().max(60).optional(),
})

/** Which pay period a payroll operation applies to. */
export const payrollRunSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
})

/** Suspending an employee: reversible, and always reasoned. */
export const suspendStaffSchema = z.object({
  ref: staffRef,
  reason: shortText,
})

/** Putting an employee on notice, ahead of a dated leaving. */
export const noticeStaffSchema = z.object({
  ref: staffRef,
  noticeDate: isoDate,
  endDate: isoDate,
  reason: shortText,
})

/** Changing a user's access level. Always audited and always notified. */
export const roleChangeSchema = z.object({
  userId: z.string().uuid(),
  role: userRole,
  reason: shortText,
})

export const offboardStaffSchema = z.object({
  ref: staffRef,
  endDate: isoDate,
  reason: shortText,
  /** Whether to revoke the linked login immediately. */
  revokeAccess: z.boolean().default(true),
})

export const attendanceEntrySchema = orderedRange(
  z.object({
    staffRefs: z.array(staffRef).min(1, 'Select at least one employee.').max(200),
    from: isoDate,
    to: isoDate,
    code: attendanceCode,
    includeWeekends: z.boolean().optional().default(false),
    overwrite: z.boolean().optional().default(true),
    jobId: z.string().uuid().nullable().optional(),
  })
)

export const crewTimesheetSchema = z.object({
  /** Exactly one code per day, Monday first. */
  codes: z.array(attendanceCode).length(7, 'A timesheet covers seven days.'),
  weekStart: isoDate.optional(),
})

export const timesheetDecisionSchema = z.object({
  timesheetId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  reason: longText.optional(),
})

export const createLeaveSchema = orderedRange(
  z.object({
    staffRef: staffRef.optional(),
    type: leaveType,
    from: isoDate,
    to: isoDate,
    startAt: z.enum(['morning', 'afternoon']).optional().default('morning'),
    endAt: z.enum(['lunchtime', 'end_of_day']).optional().default('end_of_day'),
    reason: longText.optional(),
    approveNow: z.boolean().optional().default(false),
  })
)

export const leaveDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(['approved', 'rejected']),
  note: longText.optional(),
})

export const expenseSchema = z.object({
  date: isoDate,
  category: expenseCategory,
  merchant: shortText,
  description: z.string().trim().min(1).max(500),
  amountPence: positivePence,
  vatPence: pence.default(0),
  method: expenseMethod,
  staffRef: staffRef.optional(),
  receipt: attachmentInput.nullable().optional(),
})

export const expenseDecisionSchema = z
  .object({
    id: z.string().min(1),
    decision: z.enum(['approved', 'rejected', 'reimbursed', 'reconciled']),
    reason: longText.optional(),
    paymentReference: z.string().trim().max(80).optional(),
  })
  .refine((v) => v.decision !== 'rejected' || Boolean(v.reason?.trim()), {
    message: 'Give a reason when rejecting a claim.',
    path: ['reason'],
  })
  .refine((v) => v.decision !== 'reimbursed' || Boolean(v.paymentReference?.trim()), {
    message: 'Record the payment reference when marking a claim reimbursed.',
    path: ['paymentReference'],
  })

export const invoiceLineItemSchema = z.object({
  description: shortText,
  quantity: z.number().positive().max(100000),
  unitPricePence: pence,
  /** Basis points: 2000 = 20%. */
  vatRateBasisPoints: z.number().int().min(0).max(10000).default(2000),
})

export const createInvoiceSchema = z
  .object({
    clientId: z.string().uuid().optional(),
    clientName: shortText.optional(),
    reference: shortText,
    issued: isoDate,
    due: isoDate,
    poNumber: z.string().trim().max(60).optional(),
    notes: longText.optional(),
    jobId: z.string().uuid().nullable().optional(),
    lineItems: z.array(invoiceLineItemSchema).min(1, 'Add at least one line.'),
  })
  .refine((v) => v.due >= v.issued, {
    message: 'The due date is before the issue date.',
    path: ['due'],
  })
  .refine((v) => Boolean(v.clientId || v.clientName), {
    message: 'Choose a client.',
    path: ['clientName'],
  })

export const recordPaymentSchema = z.object({
  invoiceId: z.string().min(1),
  amountPence: positivePence,
  receivedOn: isoDate,
  method: z.enum(['bank_transfer', 'card', 'cheque', 'cash', 'other']),
  /** Doubles as the idempotency key. */
  reference: z.string().trim().min(1).max(80),
  notes: longText.optional(),
})

export const voidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: shortText,
})

/** Issuing a draft: the point at which an invoice becomes a real receivable. */
export const issueInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  /** When it was actually sent to the client. Defaults to today. */
  sentOn: isoDate.optional(),
})

/** Abandoning a debt. Distinct from voiding, which cancels an error. */
export const writeOffInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: shortText,
})

/** Reviewing a compliance document. */
export const reviewDocumentSchema = z
  .object({
    documentId: z.string().uuid(),
    decision: z.enum(['valid', 'rejected']),
    notes: longText.optional(),
    expiresOn: isoDate.nullable().optional(),
  })
  .refine((v) => v.decision !== 'rejected' || Boolean(v.notes?.trim()), {
    message: 'Say why the document was rejected.',
    path: ['notes'],
  })

export const clientSchema = z.object({
  name: shortText,
  legalName: z.string().trim().max(200).optional(),
  companyNumber: z.string().trim().max(20).optional(),
  vatNumber: z.string().trim().max(20).optional(),
  billingAddressLine1: z.string().trim().max(200).optional(),
  billingCity: z.string().trim().max(100).optional(),
  billingPostcode: z.string().trim().max(12).optional(),
  primaryContactName: z.string().trim().max(120).optional(),
  primaryContactEmail: email.optional().or(z.literal('')),
  primaryContactPhone: z.string().trim().max(30).optional(),
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
  creditLimitPence: pence.nullable().optional(),
  notes: longText.optional(),
})

export const crewSchema = z.object({
  name: shortText.max(80),
  site: z.string().trim().max(120).optional(),
  supervisorRef: staffRef.nullable().optional(),
})

export const jobSchema = z.object({
  reference: shortText.max(40),
  title: shortText,
  clientId: z.string().uuid().nullable().optional(),
  crewId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(200).optional(),
  costCode: z.string().trim().max(40).optional(),
  dayRatePence: pence.nullable().optional(),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
})

export const payrollAdjustmentSchema = z.object({
  staffRef,
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  label: shortText,
  /** The operator's justification. Persisted, never discarded. */
  reason: z.string().trim().min(3, 'Explain why this adjustment is being made.').max(500),
  /** Signed: positive adds to gross, negative deducts. */
  amountPence: z
    .number()
    .int()
    .finite()
    .refine((v) => v !== 0, 'An adjustment of zero has no effect.')
    .refine((v) => Math.abs(v) <= 100_000_00, 'That adjustment is implausibly large.'),
  taxable: z.boolean().default(true),
  effectiveDate: isoDate,
})

export const staffDocumentSchema = z.object({
  staffRef,
  kind: z.enum(['pts', 'medical', 'right_to_work', 'contract', 'certification', 'other']),
  reference: z.string().trim().max(80).optional(),
  issuedOn: isoDate.nullable().optional(),
  expiresOn: isoDate.nullable().optional(),
  notes: longText.optional(),
  attachment: attachmentInput.nullable().optional(),
})

/**
 * Settings are validated per key and applied as a patch, so a partial update
 * can no longer erase every other setting.
 */
export const settingsPatchSchema = z
  .object({
    company: shortText.optional(),
    email: email.optional(),
    timezone: z.string().trim().max(60).optional(),
    currency: z.string().trim().max(20).optional(),
    payday: z.string().trim().max(40).optional(),
    leaveDays: z.number().min(0).max(365).optional(),
    carryOver: z.number().min(0).max(365).optional(),
    workingDays: z.enum(['Monday to Friday', 'Monday to Saturday']).optional(),
    standardDay: z.number().positive().max(24).optional(),
    tax: z.number().min(0).max(100).optional(),
    ni: z.number().min(0).max(100).optional(),
    pension: z.number().min(0).max(100).optional(),
    allowancePence: pence.optional(),
    notifyLeave: z.boolean().optional(),
    notifyExpenses: z.boolean().optional(),
    notifyPayroll: z.boolean().optional(),
    notifyCelebrations: z.boolean().optional(),
    smtpHost: z.string().trim().max(200).optional(),
    smtpPort: z.number().int().min(1).max(65535).optional(),
    smtpSecure: z.boolean().optional(),
    smtpUser: z.string().trim().max(200).optional(),
    /** Write-only. Absent means "leave unchanged"; never echoed back. */
    smtpPass: z.string().max(200).optional(),
    smtpFrom: email.optional().or(z.literal('')),
  })
  .strict()

// --- helpers ----------------------------------------------------------------

/**
 * Parses input and throws an AppError carrying per-field messages, so a form
 * can show the error next to the field that caused it.
 */
export function parseOrThrow<T extends z.ZodTypeAny>(
  schema: T,
  input: unknown
): z.infer<T> {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const fieldErrors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    if (!fieldErrors[key]) fieldErrors[key] = issue.message
  }
  const first = result.error.issues[0]
  throw new AppError(first?.message ?? 'Those details are not valid.', 422, 'validation', {
    fieldErrors,
  })
}
