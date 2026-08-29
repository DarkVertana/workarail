'use client'

/**
 * Employee onboarding form.
 *
 * Replaces a nine-field modal that collected a name, an email and a start date
 * and silently discarded everything else. The sections below mirror the real
 * stages of taking someone on, and each one maps to where the data is actually
 * needed:
 *
 *   Identity          the personnel record
 *   Contact & address HMRC reporting, and reaching someone after they leave
 *   Employment        rostering, leave entitlement and the contract
 *   Payroll           PAYE, National Insurance and gross pay
 *   Bank details      where net pay is sent
 *   Documents         right-to-work and competence evidence
 *   Notes             internal HR context
 *
 * Required-ness is enforced server-side as well; the `required` attributes
 * here are a courtesy, not the control.
 */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { addStaffMember } from '@/app/actions/admin'
import { uploadAttachment, formatBytes, type AttachmentRef } from '@/app/ui/upload'

type Crew = { id: string; name: string }
type StaffOption = { ref: string; name: string }

/** The document kinds collected at onboarding, in the order they appear. */
const DOCUMENT_KINDS = [
  { key: 'government_id', label: 'Government ID', hint: 'Passport, driving licence or national ID scan.' },
  { key: 'tax_document', label: 'Tax document', hint: 'P45, P60 or UTR confirmation.' },
  { key: 'ni_evidence', label: 'NI evidence', hint: 'NI number confirmation letter.' },
  { key: 'right_to_work', label: 'Right to work', hint: 'Share code result or visa page.' },
  { key: 'contract', label: 'Employment contract', hint: 'Signed contract or offer letter.' },
  { key: 'pts', label: 'PTS / Sentinel', hint: 'Sentinel card or competence record.' },
  { key: 'medical', label: 'Medical fitness', hint: 'Network Rail medical certificate.' },
  { key: 'other', label: 'Other', hint: 'CSCS, first aid, or additional papers.' },
] as const

const inputClass =
  'mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50'

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{title}</h2>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </header>
      <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  )
}

function Field({
  label,
  hint,
  required,
  error,
  children,
  wide,
}: {
  label: string
  hint?: string
  required?: boolean
  error?: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={wide ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      <label className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        {label}
        {required && <span className="ml-0.5 text-rose-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      ) : null}
    </div>
  )
}

function Text(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass} />
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputClass} />
}

/** One document slot: picks a file, uploads it, and keeps the returned key. */
function DocumentField({
  kind,
  label,
  hint,
  value,
  onChange,
}: {
  kind: string
  label: string
  hint: string
  value: AttachmentRef | null
  onChange: (kind: string, ref: AttachmentRef | null) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  return (
    <Field
      label={label}
      hint={value ? `Attached: ${value.name} (${formatBytes(value.sizeBytes)})` : hint}
      error={error ?? undefined}
    >
      <input
        type="file"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        disabled={busy}
        className="mt-1 w-full text-sm text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-500 dark:text-zinc-400"
        onChange={async (e) => {
          const file = e.target.files?.[0]
          if (!file) return onChange(kind, null)
          setBusy(true)
          setError(null)
          try {
            onChange(kind, await uploadAttachment(file))
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed.')
            onChange(kind, null)
            e.target.value = ''
          } finally {
            setBusy(false)
          }
        }}
      />
    </Field>
  )
}

export function StaffForm({
  crews,
  managers,
  suggestedRef,
}: {
  crews: Crew[]
  managers: StaffOption[]
  suggestedRef: string
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [documents, setDocuments] = useState<Record<string, AttachmentRef | null>>({})
  const [method, setMethod] = useState<'bacs' | 'international'>('bacs')

  function setDocument(kind: string, ref: AttachmentRef | null) {
    setDocuments((prev) => ({ ...prev, [kind]: ref }))
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    const fd = new FormData(e.currentTarget)
    const text = (k: string) => ((fd.get(k) as string) ?? '').trim()
    const num = (k: string) => {
      const v = text(k)
      return v === '' ? undefined : Number(v)
    }

    const payload = {
      ref: text('ref'),
      name: text('name'),
      preferredName: text('preferredName') || undefined,
      email: text('email'),
      phone: text('phone'),
      personalEmail: text('personalEmail') || undefined,
      personalPhone: text('personalPhone') || undefined,
      dateOfBirth: text('dateOfBirth') || undefined,
      gender: (text('gender') || 'prefer_not_to_say') as
        'male' | 'female' | 'non_binary' | 'prefer_not_to_say',
      nationality: text('nationality') || undefined,

      addressLine1: text('addressLine1') || undefined,
      addressLine2: text('addressLine2') || undefined,
      addressCity: text('addressCity') || undefined,
      addressPostcode: text('addressPostcode') || undefined,
      addressCountry: text('addressCountry') || undefined,
      emergencyContactName: text('emergencyContactName') || undefined,
      emergencyContactPhone: text('emergencyContactPhone') || undefined,
      emergencyContactRelation: text('emergencyContactRelation') || undefined,

      role: text('role'),
      jobTitle: text('jobTitle') || undefined,
      crewId: text('crewId'),
      managerRef: text('managerRef') || undefined,
      contractType: text('contractType') as 'permanent',
      employmentStatus: text('employmentStatus') as 'onboarding',
      joined: text('joined'),
      probationEndDate: text('probationEndDate') || undefined,
      weeklyHours: num('weeklyHours') ?? 37.5,

      // Pounds in the form, pence in the database. Converting here rather than
      // storing a float keeps the rounding in one place.
      dayRatePence: num('dayRate') === undefined
        ? undefined
        : Math.round((num('dayRate') as number) * 100),
      payFrequency: text('payFrequency') as 'monthly',
      niNumber: text('niNumber') || undefined,
      taxCode: text('taxCode') || undefined,
      taxBasis: text('taxBasis') as 'cumulative' | 'week1_month1',
      niCategory: (text('niCategory') || 'A') as 'A',
      studentLoanPlan: num('studentLoanPlan') as 1 | 2 | 4 | 5 | undefined,
      postgradLoan: fd.get('postgradLoan') === 'on',

      internalNotes: text('internalNotes') || undefined,

      // Bank details and documents are created alongside the staff record by
      // the server action, in the same transaction.
      bank: text('accountNumber') || text('iban')
        ? {
            accountHolderName: text('accountHolderName') || text('name'),
            bankName: text('bankName') || undefined,
            method,
            sortCode: text('sortCode') || undefined,
            accountNumber: text('accountNumber') || undefined,
            iban: text('iban') || undefined,
            bic: text('bic') || undefined,
          }
        : undefined,
      documents: Object.entries(documents)
        .filter(([, ref]) => ref !== null)
        .map(([kind, ref]) => ({ kind, attachment: ref as AttachmentRef })),
    }

    startTransition(async () => {
      const result = await addStaffMember(payload)
      if (!result.ok) {
        setError(result.error)
        // Field-level messages from the server, so the user is told which
        // input to fix rather than being shown one opaque banner.
        if (result.details && typeof result.details === 'object') {
          setFieldErrors(result.details as Record<string, string>)
        }
        return
      }
      router.push('/admin/crews')
      router.refresh()
    })
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 pb-24">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
        >
          {error}
        </div>
      )}

      <Section title="Identity" description="Legal name and how they appear on the roster.">
        <Field label="Employee ID" required hint="Payroll / HR reference, unique." error={fieldErrors.ref}>
          <Text name="ref" required defaultValue={suggestedRef} placeholder="EMP-015" />
        </Field>
        <Field label="Legal name" required hint="As it appears on the contract and payslip." error={fieldErrors.name}>
          <Text name="name" required placeholder="Jordan Vale" />
        </Field>
        <Field label="Preferred name" hint="Shown on the crew roster if set.">
          <Text name="preferredName" placeholder="Jord" />
        </Field>
        <Field
          label="Date of birth"
          hint="Sets the NI category and the medical age band."
          error={fieldErrors.dateOfBirth}
        >
          <Text type="date" name="dateOfBirth" />
        </Field>
        <Field label="Gender" hint="Optional, and never used for any decision.">
          <Select name="gender" defaultValue="prefer_not_to_say">
            <option value="prefer_not_to_say">Prefer not to say</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
            <option value="non_binary">Non-binary</option>
          </Select>
        </Field>
        <Field label="Nationality">
          <Text name="nationality" placeholder="British" />
        </Field>
      </Section>

      <Section
        title="Contact & address"
        description="Work details for login, plus home contact for HR."
      >
        <Field label="Work email" required hint="Creates their login and sends the invite." error={fieldErrors.email}>
          <Text type="email" name="email" required placeholder="name@workarail.com" />
        </Field>
        <Field label="Work phone" required error={fieldErrors.phone}>
          <Text type="tel" name="phone" required placeholder="+44 7700 900000" />
        </Field>
        <Field label="Personal email" hint="Used to send a P45 after their account closes.">
          <Text type="email" name="personalEmail" />
        </Field>
        <Field label="Personal phone">
          <Text type="tel" name="personalPhone" />
        </Field>
        <Field label="Address line 1">
          <Text name="addressLine1" />
        </Field>
        <Field label="Address line 2">
          <Text name="addressLine2" />
        </Field>
        <Field label="City">
          <Text name="addressCity" />
        </Field>
        <Field label="Postcode">
          <Text name="addressPostcode" placeholder="DN1 2AB" />
        </Field>
        <Field label="Country">
          <Text name="addressCountry" defaultValue="United Kingdom" />
        </Field>
        <Field label="Emergency contact" hint="Required before working on or near the line.">
          <Text name="emergencyContactName" placeholder="Sam Reed" />
        </Field>
        <Field label="Emergency contact phone">
          <Text type="tel" name="emergencyContactPhone" />
        </Field>
        <Field label="Relationship">
          <Text name="emergencyContactRelation" placeholder="Partner" />
        </Field>
      </Section>

      <Section title="Employment" description="Role, reporting line and contract terms.">
        <Field label="Trade / role" required hint="Drives crew composition." error={fieldErrors.role}>
          <Text name="role" required placeholder="Track Operative" />
        </Field>
        <Field label="Job title" hint="As printed on the contract and payslip.">
          <Text name="jobTitle" placeholder="Track Operative" />
        </Field>
        <Field label="Crew">
          <Select name="crewId" defaultValue="">
            <option value="">Unassigned</option>
            {crews.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Reports to">
          <Select name="managerRef" defaultValue="">
            <option value="">No manager</option>
            {managers.map((m) => (
              <option key={m.ref} value={m.ref}>{m.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Contract type">
          <Select name="contractType" defaultValue="permanent">
            <option value="permanent">Permanent</option>
            <option value="fixed_term">Fixed term</option>
            <option value="agency">Agency</option>
            <option value="subcontractor">Subcontractor</option>
            <option value="apprentice">Apprentice</option>
          </Select>
        </Field>
        <Field
          label="Employment status"
          hint="Onboarding until right-to-work and contract are on file."
        >
          <Select name="employmentStatus" defaultValue="onboarding">
            <option value="onboarding">Onboarding</option>
            <option value="active">Active</option>
          </Select>
        </Field>
        <Field label="Start date" required error={fieldErrors.joined}>
          <Text type="date" name="joined" required />
        </Field>
        <Field label="Probation ends" hint="Leave blank where none applies.">
          <Text type="date" name="probationEndDate" />
        </Field>
        <Field label="Contracted hours a week" hint="Pro-rates leave entitlement.">
          <Text type="number" name="weeklyHours" step="0.5" min="1" max="80" defaultValue="37.5" />
        </Field>
      </Section>

      <Section
        title="Payroll"
        description="PAYE details. Without a tax code, payroll will not pay this employee."
      >
        <Field label="Day rate (£)" hint="Gross, before deductions." error={fieldErrors.dayRatePence}>
          <Text type="number" name="dayRate" step="0.01" min="0" placeholder="185.00" />
        </Field>
        <Field label="Pay frequency" hint="Sets the PAYE period and NI thresholds.">
          <Select name="payFrequency" defaultValue="monthly">
            <option value="monthly">Monthly</option>
            <option value="four_weekly">Four-weekly</option>
            <option value="fortnightly">Fortnightly</option>
            <option value="weekly">Weekly</option>
          </Select>
        </Field>
        <Field
          label="National Insurance number"
          hint="Format AB123456C."
          error={fieldErrors.niNumber}
        >
          <Text name="niNumber" placeholder="AB123456C" style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field
          label="Tax code"
          hint="From their P45 or a P6 coding notice. Leave blank if not yet issued."
          error={fieldErrors.taxCode}
        >
          <Text name="taxCode" placeholder="1257L" style={{ textTransform: 'uppercase' }} />
        </Field>
        <Field label="Tax basis" hint="Week 1/month 1 for a starter without a P45.">
          <Select name="taxBasis" defaultValue="cumulative">
            <option value="cumulative">Cumulative</option>
            <option value="week1_month1">Week 1 / month 1</option>
          </Select>
        </Field>
        <Field label="NI category" hint="A is standard. C over pension age, M under 21, H apprentice.">
          <Select name="niCategory" defaultValue="A">
            {['A', 'B', 'C', 'H', 'J', 'M', 'V', 'Z', 'X'].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
        <Field label="Student loan plan" hint="From an SL1 start notice.">
          <Select name="studentLoanPlan" defaultValue="">
            <option value="">None</option>
            <option value="1">Plan 1</option>
            <option value="2">Plan 2</option>
            <option value="4">Plan 4 (Scotland)</option>
            <option value="5">Plan 5</option>
          </Select>
        </Field>
        <Field label="Postgraduate loan" hint="Runs alongside a plan loan.">
          <label className="mt-2 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" name="postgradLoan" className="h-4 w-4 rounded" />
            Deduct postgraduate loan
          </label>
        </Field>
      </Section>

      <Section
        title="Bank details"
        description="Where net pay is sent. Finance must verify these before the first pay run."
      >
        <Field label="Account holder name" hint="Must match the name on the account.">
          <Text name="accountHolderName" />
        </Field>
        <Field label="Bank name">
          <Text name="bankName" placeholder="Barclays" />
        </Field>
        <Field label="Payment method">
          <Select
            name="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as 'bacs' | 'international')}
          >
            <option value="bacs">UK bank transfer (BACS)</option>
            <option value="international">International</option>
          </Select>
        </Field>

        {method === 'bacs' ? (
          <>
            <Field label="Sort code" hint="Six digits." error={fieldErrors.sortCode}>
              <Text name="sortCode" placeholder="12-34-56" inputMode="numeric" />
            </Field>
            <Field label="Account number" hint="Eight digits. Stored encrypted." error={fieldErrors.accountNumber}>
              <Text name="accountNumber" placeholder="12345678" inputMode="numeric" />
            </Field>
          </>
        ) : (
          <>
            <Field label="IBAN" hint="For overseas or contractor payments." error={fieldErrors.iban}>
              <Text name="iban" placeholder="GB33BUKB20201555555555" />
            </Field>
            <Field label="BIC / SWIFT">
              <Text name="bic" placeholder="BUKBGB22" />
            </Field>
          </>
        )}
      </Section>

      <Section title="Documents" description="Attach scans. PDF or image, up to a few megabytes each.">
        {DOCUMENT_KINDS.map((d) => (
          <DocumentField
            key={d.key}
            kind={d.key}
            label={d.label}
            hint={d.hint}
            value={documents[d.key] ?? null}
            onChange={setDocument}
          />
        ))}
      </Section>

      <Section title="Notes" description="Anything else HR or ops should see on this file.">
        <Field label="Internal notes" hint="Never shown to the employee." wide>
          <textarea
            name="internalNotes"
            rows={4}
            className={inputClass}
            placeholder="Context that belongs on the personnel file."
          />
        </Field>
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-zinc-200 bg-white/95 px-6 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95 lg:pl-[17rem]">
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Identity documents are stored on this server under uploads.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => router.push('/admin/crews')}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
            >
              {pending ? 'Saving...' : 'Save staff member'}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
