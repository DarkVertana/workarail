'use client'

import { useEffect, useRef } from 'react'
import type { Attachment } from '@/app/lib/admin-data'
import { STAT_ICON } from '@/app/ui/admin/stat-card'

export type PreviewTarget = {
  file: Attachment
  /** Headline for the dialog, e.g. the invoice or expense id. */
  title: string
  /** Supporting line, e.g. client, amount, size. */
  subtitle: string
  /** Optional note pinned under the viewer. */
  note?: string
}

/**
 * Shared attachment viewer for invoices and expenses. Native <dialog> so focus
 * trapping, Escape and the backdrop come from the platform rather than
 * hand-rolled listeners.
 */
export function AttachmentPreview({
  target,
  onClose,
}: {
  target: PreviewTarget | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (target && !el.open) el.showModal()
    if (!target && el.open) el.close()
  }, [target])

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
      aria-label="Attachment preview"
      className="m-auto w-[min(56rem,92vw)] rounded-xl border border-zinc-200 bg-white p-0 backdrop:bg-black/50"
    >
      {target ? (
        <>
          <div className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-zinc-900">
                {target.file.name}
              </p>
              <p className="truncate text-xs text-zinc-500">
                {target.title} · {target.subtitle}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {target.file.url ? (
                <a
                  href={target.file.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                >
                  Open in new tab
                </a>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close preview"
                className="rounded-md p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                <svg {...STAT_ICON}>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-auto bg-zinc-50 p-4">
            {/*
              Historical rows stored a browser blob: or inline data: URL as the
              permanent reference. Those cannot be resolved from the server and
              must never be turned back into a live href, so they are reported
              as missing instead.
            */}
            {!target.file.url ? (
              <p
                role="status"
                className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800"
              >
                This file is no longer available. It was uploaded before
                attachments were stored properly and only ever existed in the
                browser session that created it. Ask for it to be re-uploaded.
              </p>
            ) : target.file.kind === 'image' ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={target.file.url}
                alt={`Attachment for ${target.title}`}
                className="mx-auto max-w-full rounded-lg border border-zinc-200 bg-white"
              />
            ) : (
              <object
                data={target.file.url}
                type="application/pdf"
                aria-label={`PDF preview of ${target.file.name}`}
                className="h-[65vh] w-full rounded-lg border border-zinc-200 bg-white"
              >
                <p className="p-6 text-center text-sm text-zinc-600">
                  This browser can&apos;t display the PDF inline.{' '}
                  <a
                    href={target.file.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-indigo-600 underline underline-offset-4"
                  >
                    Open it in a new tab
                  </a>
                  .
                </p>
              </object>
            )}
          </div>

          {target.note ? (
            <p className="border-t border-zinc-200 px-5 py-2.5 text-xs text-zinc-500">
              {target.note}
            </p>
          ) : null}
        </>
      ) : null}
    </dialog>
  )
}
