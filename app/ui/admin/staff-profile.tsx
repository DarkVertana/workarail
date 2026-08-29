'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  assignStaffToJob,
  deleteStaffMember,
  setStaffStatus,
  type StaffDetail,
} from '@/app/actions/admin'
import { useRegisterPageAction } from '@/app/ui/admin/page-action'
import { useToast } from '@/app/ui/toast'

type Staff = NonNullable<StaffDetail>
type Job = { id: string; title: string }

const STATUS_LABEL: Record<string, string> = {
  'on-site': 'On site',
  available: 'Available',
  'off-shift': 'Off shift',
}

const STATUS_BADGE: Record<string, string> = {
  'on-site': 'bg-[#0ca30c]/10 text-[#006300]',
  available: 'bg-zinc-100 text-zinc-700',
  'off-shift': 'bg-zinc-100 text-zinc-500',
}

const GOV_ID_LABEL: Record<string, string> = {
  passport: 'Passport',
  driving_licence: 'Driving licence',
  national_id: 'National ID',
  other: 'Other',
}

const RTW_LABEL: Record<string, string> = {
  british_citizen: 'British citizen',
  irish_citizen: 'Irish citizen',
  settled: 'Settled / pre-settled',
  visa: 'Visa',
  other: 'Other',
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts.at(-1)![0] : '')).toUpperCase()
}

/** '2023-03-12' -> '12/03/2023'. String maths, so no timezone drift. */
function formatDate(iso: string | null) {
  if (!iso) return null
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function money(pence: number | null, payType: string | null) {
  if (pence == null) return null
  const amount = (pence / 100).toLocaleString('en-GB', {
    style: 'currency',
    currency: 'GBP',
  })
  if (payType === 'hourly') return `${amount} per hour`
  if (payType === 'salary') return `${amount} per year`
  return amount
}

export function StaffProfile({ staff, jobs }: { staff: Staff; jobs: Job[] }) {
  const router = useRouter()
  const toast = useToast()
  const [pending, startTransition] = useTransition()
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  useRegisterPageAction('Edit', () =>
    router.push(`/admin/crews/${staff.ref}/edit`)
  )

  /** Runs a server action, surfaces its error, and refreshes on success. */
  function run(
    action: () => Promise<{ ok?: true; error?: string }>,
    success: string,
    after?: () => void
  ) {
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        toast(result.error, 'error')
        return
      }
      toast(success)
      if (after) after()
      else router.refresh()
    })
  }

  function onAssign(jobId: string) {
    const target = jobId === '' ? null : jobId
    run(
      () => assignStaffToJob(staff.ref, target),
      target ? `Assigned to ${target}.` : 'Unassigned from job.'
    )
  }

  function onStatus(status: string) {
    run(
      () => setStaffStatus(staff.ref, status),
      `Status set to ${STATUS_LABEL[status] ?? status}.`
    )
  }

  function onRemove() {
    run(() => deleteStaffMember(staff.ref), `${staff.name} removed.`, () =>
      router.push('/admin/crews')
    )
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-xs">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <span
              aria-hidden="true"
              className="flex size-14 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg font-semibold text-indigo-700"
            >
              {initials(staff.name)}
            </span>
            <div className="min-w-0">
              <h2 className="truncate text-xl font-semibold text-zinc-900">
                {staff.name}
                {staff.preferredName ? (
                  <span className="ml-2 text-base font-normal text-zinc-500">
                    “{staff.preferredName}”
                  </span>
                ) : null}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {staff.ref} · {staff.role} · {staff.crewName}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_BADGE[staff.status] ?? STATUS_BADGE.available
                  }`}
                >
                  {STATUS_LABEL[staff.status] ?? staff.status}
                </span>
                <span className="text-xs text-zinc-500">
                  {staff.currentJobLabel ?? 'No job assigned'}
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/crews/${staff.ref}/edit`}
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Edit
            </Link>
            <button
              type="button"
              onClick={() => setConfirmingRemove(true)}
              disabled={pending}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:opacity-60"
            >
              Remove
            </button>
          </div>
        </div>

        <div className="mt-6 grid gap-4 border-t border-zinc-200 pt-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">
              Assign to job
            </span>
            <select
              value={staff.currentJobId ?? ''}
              onChange={(e) => onAssign(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-60"
            >
              <option value="">Not assigned</option>
              {jobs.map((job) => (
                <option key={job.id} value={job.id}>
                  {job.id} · {job.title}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500">
              Assigning puts them on site; clearing frees them up.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Status</span>
            <select
              value={staff.status}
              onChange={(e) => onStatus(e.target.value)}
              disabled={pending}
              className="h-10 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-500/40 disabled:opacity-60"
            >
              <option value="on-site">On site</option>
              <option value="available">Available</option>
              <option value="off-shift">Off shift</option>
            </select>
            <span className="text-xs text-zinc-500">
              Moving off a job clears the assignment.
            </span>
          </label>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Contact">
          <Row label="Work email" value={staff.email} />
          <Row label="Work phone" value={staff.phone} />
          <Row label="Personal email" value={staff.personalEmail} />
          <Row label="Personal phone" value={staff.personalPhone} />
          <Row
            label="Address"
            value={
              [
                staff.addressLine1,
                staff.addressLine2,
                staff.city,
                staff.postcode,
                staff.country,
              ]
                .filter(Boolean)
                .join(', ') || null
            }
          />
        </Card>

        <Card title="Emergency contact">
          <Row label="Name" value={staff.emergencyName} />
          <Row label="Phone" value={staff.emergencyPhone} />
          <Row label="Relationship" value={staff.emergencyRelation} />
        </Card>

        <Card title="Personal">
          <Row label="Date of birth" value={formatDate(staff.dateOfBirth)} />
          <Row label="Gender" value={staff.gender} />
          <Row label="Nationality" value={staff.nationality} />
          <Row label="Birthday" value={staff.birthday} />
        </Card>

        <Card title="Employment">
          <Row label="Start date" value={formatDate(staff.joined)} />
          <Row label="Employment type" value={staff.employmentType} />
          <Row label="Probation end" value={formatDate(staff.probationEnd)} />
          <Row label="Contract end" value={formatDate(staff.contractEnd)} />
          <Row
            label="Hours per week"
            value={staff.hoursPerWeek != null ? String(staff.hoursPerWeek) : null}
          />
          <Row label="Pay" value={money(staff.payRatePence, staff.payType)} />
          <Row label="Work location" value={staff.workLocation} />
          <Row label="Line manager" value={staff.lineManager} />
          <Row label="Notice period" value={staff.noticePeriod} />
        </Card>

        <Card title="Government ID">
          <Row
            label="Type"
            value={staff.govIdType ? (GOV_ID_LABEL[staff.govIdType] ?? staff.govIdType) : null}
          />
          <Row label="Number" value={staff.govIdNumber} />
          <Row label="Issuing country" value={staff.govIdCountry} />
          <Row label="Expiry" value={formatDate(staff.govIdExpiry)} />
        </Card>

        <Card title="Tax & National Insurance">
          <Row label="NI number" value={staff.niNumber} />
          <Row label="Tax ID / UTR" value={staff.taxId} />
          <Row label="Tax code" value={staff.taxCode} />
          <Row label="Tax residency" value={staff.taxResidency} />
          <Row label="Student loan" value={staff.studentLoan ? 'Yes' : 'No'} />
        </Card>

        <Card title="Right to work">
          <Row
            label="Basis"
            value={
              staff.rightToWork ? (RTW_LABEL[staff.rightToWork] ?? staff.rightToWork) : null
            }
          />
          <Row label="Visa type" value={staff.visaType} />
          <Row label="Visa / RTW expiry" value={formatDate(staff.visaExpiry)} />
        </Card>

        <Card title="Rail compliance">
          <Row label="PTS / Sentinel" value={staff.ptsNumber} />
          <Row label="PTS expiry" value={formatDate(staff.ptsExpiry)} />
          <Row label="Medical expiry" value={formatDate(staff.medicalExpiry)} />
        </Card>

        <Card title="Bank details">
          <Row label="Account name" value={staff.bankAccountName} />
          <Row label="Sort code" value={staff.bankSortCode} />
          <Row label="Account number" value={staff.bankAccountNumber} />
          <Row label="IBAN" value={staff.iban} />
        </Card>

        <Card title="Documents">
          {staff.documents.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Nothing on file yet — attach scans from the edit page.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-zinc-100">
              {staff.documents.map((doc) => (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-zinc-800">
                      {doc.title}
                    </p>
                    <p className="truncate text-xs text-zinc-500">
                      {[doc.reference, doc.fileName].filter(Boolean).join(' · ') ||
                        doc.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {doc.expiresOn ? (
                      <span className="text-xs text-zinc-500">
                        expires {formatDate(doc.expiresOn)}
                      </span>
                    ) : null}
                    {doc.url ? (
                      <a
                        href={doc.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium text-indigo-600 hover:underline"
                      >
                        Open
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {staff.notes ? (
          <Card title="Notes">
            <p className="text-sm whitespace-pre-line text-zinc-700">
              {staff.notes}
            </p>
          </Card>
        ) : null}
      </div>

      {confirmingRemove ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-zinc-900">
              Remove {staff.name}?
            </h3>
            <p className="mt-2 text-sm text-zinc-600">
              This deletes the employee file, their attendance, leave, expenses,
              payroll history and their login. It cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingRemove(false)}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onRemove}
                disabled={pending}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-60"
              >
                {pending ? 'Removing…' : 'Remove employee'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Card({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xs">
      <div className="border-b border-zinc-200 bg-zinc-50/70 px-5 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </section>
  )
}

function Row({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-zinc-100 py-2 last:border-0 first:pt-0 last:pb-0">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-zinc-900">
        {value ?? <span className="font-normal text-zinc-400">Not set</span>}
      </span>
    </div>
  )
}
