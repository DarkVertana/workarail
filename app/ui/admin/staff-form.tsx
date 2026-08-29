'use client'

import { useId, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  addStaffMemberFromForm,
  updateStaffMemberFromForm,
  type StaffDetail,
} from '@/app/actions/admin'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { useToast } from '@/app/ui/toast'

const control =
  'h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40'

// `:read-only` also matches <select>, so this can't live on `control`.
const lockedControl = `${control} bg-zinc-100 text-zinc-500`

const selectControl = `${control} appearance-none bg-[url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round'%3E%3Cpath d='m6 9.5 6 6 6-6'/%3E%3C/svg%3E")] bg-[length:1rem] bg-[right_0.65rem_center] bg-no-repeat pr-9`

const fileControl =
  'w-full cursor-pointer rounded-lg border border-dashed border-zinc-300 bg-zinc-50/80 px-3 py-2.5 text-sm text-zinc-600 transition hover:border-indigo-400 hover:bg-indigo-50/40 file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-indigo-600 file:px-2.5 file:py-1 file:text-xs file:font-medium file:text-white'

const DOCUMENTS = [
  { field: 'docGovId', label: 'Government ID', hint: 'Passport, driving licence or national ID scan.' },
  { field: 'docTax', label: 'Tax document', hint: 'P45, P60, or UTR confirmation.' },
  { field: 'docNi', label: 'NI evidence', hint: 'NI number confirmation letter.' },
  { field: 'docRightToWork', label: 'Right to work', hint: 'Share code result or visa page.' },
  { field: 'docContract', label: 'Employment contract', hint: 'Signed contract or offer letter.' },
  { field: 'docPts', label: 'PTS / Sentinel', hint: 'Sentinel card or competence record.' },
  { field: 'docMedical', label: 'Medical fitness', hint: 'Network Rail medical certificate.' },
  { field: 'docOther', label: 'Other', hint: 'CSCS, first aid, or additional papers.' },
] as const

/**
 * One form for both creating and editing an employee. Pass `staff` to edit —
 * the employee ID then becomes read-only, since payroll and expenses key off it.
 */
export function StaffForm({
  crews,
  staff,
}: {
  crews: Array<{ id: string; name: string }>
  staff?: NonNullable<StaffDetail>
}) {
  const formRef = useRef<HTMLFormElement>(null)
  const [saving, setSaving] = useState(false)
  const toast = useToast()
  const router = useRouter()
  const today = new Date().toISOString().split('T')[0]

  const editing = Boolean(staff)
  const backHref = staff ? `/admin/crews/${staff.ref}` : '/admin/crews'

  useRegisterPageAction(editing ? 'Save changes' : 'Save staff member', () =>
    formRef.current?.requestSubmit()
  )

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSaving(true)
    try {
      const formData = new FormData(e.currentTarget)
      const result = staff
        ? await updateStaffMemberFromForm(staff.ref, formData)
        : await addStaffMemberFromForm(formData)
      if ('error' in result && result.error) {
        toast(result.error, 'error')
        return
      }
      toast(editing ? 'Changes saved.' : 'Staff member saved.')
      router.push(backHref)
    } catch (err) {
      toast(String(err), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="flex w-full min-w-0 flex-col gap-5"
    >
      {crews.length === 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Create a crew on the Crews page first — every employee must be assigned
          to one.
        </p>
      ) : null}

      <Section
        title="Identity"
        description="Legal name and how they appear on the roster."
      >
        <Field
          label="Employee ID"
          hint={
            editing
              ? 'Fixed — payroll and expenses reference this.'
              : 'Payroll / HR reference, unique.'
          }
          required
        >
          <input
            name="ref"
            required
            readOnly={editing}
            placeholder="EMP-015"
            defaultValue={staff?.ref ?? ''}
            className={editing ? lockedControl : control}
          />
        </Field>
        <Field label="Legal name" required>
          <input
            name="name"
            required
            placeholder="Jordan Vale"
            defaultValue={staff?.name ?? ''}
            className={control}
          />
        </Field>
        <Field label="Preferred name" hint="Shown on the crew roster if set.">
          <input
            name="preferredName"
            defaultValue={staff?.preferredName ?? ''}
            className={control}
          />
        </Field>
        <Field label="Date of birth" hint="Birthday on Celebrations is taken from this.">
          <input
            name="dateOfBirth"
            type="date"
            defaultValue={staff?.dateOfBirth ?? ''}
            className={control}
          />
        </Field>
        <Field label="Gender">
          <Select
            name="gender"
            defaultValue={staff?.gender ?? ''}
            options={[
              { value: '', label: 'Prefer not to say' },
              { value: 'female', label: 'Female' },
              { value: 'male', label: 'Male' },
              { value: 'non-binary', label: 'Non-binary' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </Field>
        <Field label="Nationality">
          <input
            name="nationality"
            placeholder="British"
            defaultValue={staff?.nationality ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Contact & address"
        description="Work details for login, plus home contact for HR."
      >
        <Field
          label="Work email"
          hint={editing ? 'Also their login.' : 'Creates their login and sends the invite.'}
          required
        >
          <input
            name="email"
            type="email"
            required
            placeholder="name@workarail.com"
            defaultValue={staff?.email ?? ''}
            className={control}
          />
        </Field>
        <Field label="Work phone" required>
          <input
            name="phone"
            type="tel"
            required
            placeholder="+44 7700 900000"
            defaultValue={staff?.phone ?? ''}
            className={control}
          />
        </Field>
        <Field label="Personal email">
          <input
            name="personalEmail"
            type="email"
            defaultValue={staff?.personalEmail ?? ''}
            className={control}
          />
        </Field>
        <Field label="Personal phone">
          <input
            name="personalPhone"
            type="tel"
            defaultValue={staff?.personalPhone ?? ''}
            className={control}
          />
        </Field>
        <Field label="Address line 1">
          <input
            name="addressLine1"
            defaultValue={staff?.addressLine1 ?? ''}
            className={control}
          />
        </Field>
        <Field label="Address line 2">
          <input
            name="addressLine2"
            defaultValue={staff?.addressLine2 ?? ''}
            className={control}
          />
        </Field>
        <Field label="City">
          <input name="city" defaultValue={staff?.city ?? ''} className={control} />
        </Field>
        <Field label="Postcode">
          <input
            name="postcode"
            defaultValue={staff?.postcode ?? ''}
            className={control}
          />
        </Field>
        <Field label="Country">
          <input
            name="country"
            defaultValue={staff ? (staff.country ?? '') : 'United Kingdom'}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Emergency contact"
        description="Who we call if something happens on site."
      >
        <Field label="Contact name">
          <input
            name="emergencyName"
            defaultValue={staff?.emergencyName ?? ''}
            className={control}
          />
        </Field>
        <Field label="Phone">
          <input
            name="emergencyPhone"
            type="tel"
            defaultValue={staff?.emergencyPhone ?? ''}
            className={control}
          />
        </Field>
        <Field label="Relationship">
          <input
            name="emergencyRelation"
            placeholder="Partner, parent…"
            defaultValue={staff?.emergencyRelation ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Employment"
        description="How they are engaged, paid, and rostered."
      >
        <Field label="Role" required>
          <input
            name="role"
            required
            placeholder="Track operative"
            defaultValue={staff?.role ?? ''}
            className={control}
          />
        </Field>
        <Field label="Crew" required>
          <select
            name="crewId"
            required
            className={selectControl}
            defaultValue={staff?.crewId ?? ''}
          >
            <option value="" disabled>
              Select a crew
            </option>
            {crews.map((crew) => (
              <option key={crew.id} value={crew.id}>
                {crew.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <Select
            name="status"
            defaultValue={staff?.status ?? 'available'}
            options={[
              { value: 'available', label: 'Available' },
              { value: 'on-site', label: 'On site' },
              { value: 'off-shift', label: 'Off shift' },
            ]}
          />
        </Field>
        <Field label="Employment type">
          <Select
            name="employmentType"
            defaultValue={staff?.employmentType ?? ''}
            options={[
              { value: '', label: 'Not set' },
              { value: 'permanent', label: 'Permanent' },
              { value: 'fixed-term', label: 'Fixed term' },
              { value: 'contractor', label: 'Contractor' },
              { value: 'agency', label: 'Agency' },
            ]}
          />
        </Field>
        <Field label="Start date" required>
          <input
            name="joined"
            type="date"
            required
            defaultValue={staff?.joined ?? today}
            className={control}
          />
        </Field>
        <Field label="Probation end">
          <input
            name="probationEnd"
            type="date"
            defaultValue={staff?.probationEnd ?? ''}
            className={control}
          />
        </Field>
        <Field label="Contract end" hint="Leave blank for permanent staff.">
          <input
            name="contractEnd"
            type="date"
            defaultValue={staff?.contractEnd ?? ''}
            className={control}
          />
        </Field>
        <Field label="Hours per week">
          <input
            name="hoursPerWeek"
            type="number"
            step="0.5"
            min="0"
            placeholder="40"
            defaultValue={staff?.hoursPerWeek ?? ''}
            className={control}
          />
        </Field>
        <Field label="Pay type">
          <Select
            name="payType"
            defaultValue={staff?.payType ?? ''}
            options={[
              { value: '', label: 'Not set' },
              { value: 'salary', label: 'Salary' },
              { value: 'hourly', label: 'Hourly' },
            ]}
          />
        </Field>
        <Field label="Pay rate" hint="Gross pounds — per year, or per hour.">
          <input
            name="payRatePounds"
            type="number"
            step="0.01"
            min="0"
            defaultValue={
              staff?.payRatePence != null ? staff.payRatePence / 100 : ''
            }
            className={control}
          />
        </Field>
        <Field label="Work location">
          <input
            name="workLocation"
            placeholder="Depot, region, or site"
            defaultValue={staff?.workLocation ?? ''}
            className={control}
          />
        </Field>
        <Field label="Line manager">
          <input
            name="lineManager"
            defaultValue={staff?.lineManager ?? ''}
            className={control}
          />
        </Field>
        <Field label="Notice period">
          <input
            name="noticePeriod"
            placeholder="4 weeks"
            defaultValue={staff?.noticePeriod ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Government ID"
        description="Identity document used for right-to-work and site access."
      >
        <Field label="ID type">
          <Select
            name="govIdType"
            defaultValue={staff?.govIdType ?? ''}
            options={[
              { value: '', label: 'Not set' },
              { value: 'passport', label: 'Passport' },
              { value: 'driving_licence', label: 'Driving licence' },
              { value: 'national_id', label: 'National ID' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </Field>
        <Field label="ID number">
          <input
            name="govIdNumber"
            defaultValue={staff?.govIdNumber ?? ''}
            className={control}
          />
        </Field>
        <Field label="Issuing country">
          <input
            name="govIdCountry"
            placeholder="United Kingdom"
            defaultValue={staff?.govIdCountry ?? ''}
            className={control}
          />
        </Field>
        <Field label="Expiry">
          <input
            name="govIdExpiry"
            type="date"
            defaultValue={staff?.govIdExpiry ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Tax & National Insurance"
        description="PAYE, UTR for contractors, and student loan."
      >
        <Field label="NI number" hint="QQ 12 34 56 C format.">
          <input
            name="niNumber"
            placeholder="QQ123456C"
            defaultValue={staff?.niNumber ?? ''}
            className={control}
          />
        </Field>
        <Field label="Tax ID / UTR" hint="Unique Taxpayer Reference for contractors.">
          <input name="taxId" defaultValue={staff?.taxId ?? ''} className={control} />
        </Field>
        <Field label="Tax code" hint="e.g. 1257L.">
          <input
            name="taxCode"
            placeholder="1257L"
            defaultValue={staff?.taxCode ?? ''}
            className={control}
          />
        </Field>
        <Field label="Tax residency">
          <input
            name="taxResidency"
            defaultValue={staff ? (staff.taxResidency ?? '') : 'United Kingdom'}
            className={control}
          />
        </Field>
        <Toggle
          name="studentLoan"
          label="Student loan"
          hint="Deduct student loan from payroll when a plan is in force."
          defaultChecked={staff?.studentLoan ?? false}
        />
      </Section>

      <Section
        title="Right to work"
        description="Eligibility to work in the UK, plus visa if that is how they qualify."
      >
        <Field label="Basis">
          <Select
            name="rightToWork"
            defaultValue={staff?.rightToWork ?? ''}
            options={[
              { value: '', label: 'Not recorded' },
              { value: 'british_citizen', label: 'British citizen' },
              { value: 'irish_citizen', label: 'Irish citizen' },
              { value: 'settled', label: 'Settled / pre-settled' },
              { value: 'visa', label: 'Visa' },
              { value: 'other', label: 'Other' },
            ]}
          />
        </Field>
        <Field label="Visa type">
          <input
            name="visaType"
            defaultValue={staff?.visaType ?? ''}
            className={control}
          />
        </Field>
        <Field label="Visa / RTW expiry">
          <input
            name="visaExpiry"
            type="date"
            defaultValue={staff?.visaExpiry ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Rail compliance"
        description="Sentinel / PTS and medical fitness for track work."
      >
        <Field label="PTS / Sentinel number">
          <input
            name="ptsNumber"
            defaultValue={staff?.ptsNumber ?? ''}
            className={control}
          />
        </Field>
        <Field label="PTS expiry">
          <input
            name="ptsExpiry"
            type="date"
            defaultValue={staff?.ptsExpiry ?? ''}
            className={control}
          />
        </Field>
        <Field label="Medical expiry">
          <input
            name="medicalExpiry"
            type="date"
            defaultValue={staff?.medicalExpiry ?? ''}
            className={control}
          />
        </Field>
      </Section>

      <Section
        title="Bank details"
        description="Used for PAYE and expense reimbursement. Treat as confidential."
      >
        <Field label="Account name">
          <input
            name="bankAccountName"
            defaultValue={staff?.bankAccountName ?? ''}
            className={control}
          />
        </Field>
        <Field label="Sort code">
          <input
            name="bankSortCode"
            placeholder="00-00-00"
            defaultValue={staff?.bankSortCode ?? ''}
            className={control}
          />
        </Field>
        <Field label="Account number">
          <input
            name="bankAccountNumber"
            defaultValue={staff?.bankAccountNumber ?? ''}
            className={control}
          />
        </Field>
        <Field label="IBAN" hint="For overseas or contractor payments.">
          <input name="iban" defaultValue={staff?.iban ?? ''} className={control} />
        </Field>
      </Section>

      <Section
        title="Documents"
        description={
          editing
            ? 'Uploading replaces nothing — new files are added to the file.'
            : 'Attach scans. PDF or image, up to a few megabytes each.'
        }
      >
        {staff && staff.documents.length > 0 ? (
          <div className="sm:col-span-full">
            <p className="mb-2 text-sm font-medium text-zinc-700">On file</p>
            <ul className="flex flex-wrap gap-2">
              {staff.documents.map((doc) => (
                <li key={doc.id}>
                  <a
                    href={doc.url ?? '#'}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:border-indigo-300 hover:text-indigo-700"
                  >
                    {doc.title}
                    {doc.expiresOn ? (
                      <span className="text-zinc-400">exp {doc.expiresOn}</span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {DOCUMENTS.map((doc) => (
          <Field key={doc.field} label={doc.label} hint={doc.hint}>
            <input
              name={doc.field}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp"
              className={fileControl}
            />
          </Field>
        ))}
      </Section>

      <Section
        title="Notes"
        description="Anything else HR or ops should see on this file."
      >
        <Field label="Internal notes" full>
          <textarea
            name="notes"
            rows={4}
            placeholder="Certifications, working preferences, anything worth flagging."
            defaultValue={staff?.notes ?? ''}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-xs outline-none transition placeholder:text-zinc-400 hover:border-zinc-400 focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40"
          />
        </Field>
      </Section>

      <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <p className="text-xs text-zinc-500">
          Identity documents are stored on this server under uploads.
        </p>
        <div className="flex items-center gap-2">
          <Link
            href={backHref}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || crews.length === 0}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving
              ? 'Saving…'
              : editing
                ? 'Save changes'
                : 'Save staff member'}
          </button>
        </div>
      </div>
    </form>
  )
}

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
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-zinc-200 bg-zinc-50/70 px-6 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">{title}</h2>
        <p className="text-sm text-zinc-500">{description}</p>
      </div>
      <div className="grid gap-x-6 gap-y-5 px-6 py-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {children}
      </div>
    </section>
  )
}

/** Label above control, so a card can hold three or four fields per row. */
function Field({
  label,
  hint,
  required,
  full,
  children,
}: {
  label: string
  hint?: string
  required?: boolean
  /** Span the whole card row — for textareas and the like. */
  full?: boolean
  children: React.ReactNode
}) {
  const id = useId()
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${full ? 'sm:col-span-full' : ''}`}>
      <label htmlFor={id} className="text-sm font-medium text-zinc-700">
        {label}
        {required ? (
          <span aria-hidden="true" className="ml-0.5 text-indigo-600">
            *
          </span>
        ) : null}
      </label>
      <Cloned id={id}>{children}</Cloned>
      {hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  )
}

function Cloned({ id, children }: { id: string; children: React.ReactNode }) {
  if (typeof children === 'object' && children !== null && 'props' in children) {
    const el = children as React.ReactElement<{ id?: string }>
    return <el.type {...el.props} id={id} />
  }
  return <>{children}</>
}

function Select({
  name,
  options,
  defaultValue,
  id,
}: {
  name: string
  options: Array<{ value: string; label: string }>
  defaultValue?: string
  id?: string
}) {
  return (
    <select
      id={id}
      name={name}
      defaultValue={defaultValue ?? options[0]?.value}
      className={selectControl}
    >
      {options.map((o) => (
        <option key={o.value || 'empty'} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

function Toggle({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string
  label: string
  hint: string
  defaultChecked?: boolean
}) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-zinc-200 bg-zinc-50/70 px-4 py-3 sm:col-span-2 xl:col-span-1">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-sm font-medium text-zinc-700">{label}</span>
        <span className="mt-0.5 block text-xs text-zinc-500">{hint}</span>
      </label>
      <span className="relative inline-flex shrink-0 items-center">
        <input
          id={id}
          name={name}
          type="checkbox"
          role="switch"
          defaultChecked={defaultChecked}
          className="peer size-9 cursor-pointer appearance-none rounded-full opacity-0"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-0 h-5 w-9 -translate-y-1/2 rounded-full bg-zinc-200 transition peer-checked:bg-indigo-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-indigo-500"
        />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-[1.125rem] size-4 -translate-y-1/2 rounded-full bg-white transition-all peer-checked:right-0.5"
        />
      </span>
    </div>
  )
}
