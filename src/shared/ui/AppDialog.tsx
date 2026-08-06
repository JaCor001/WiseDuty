import { useState } from 'react'
import { createPortal } from 'react-dom'
import './AppDialog.css'

export type AppDialogKind = 'alert' | 'confirm' | 'choice'

/** Visual severity for dialog chrome (default / ≈MAX amber / delete-style red). */
export type AppDialogTone = 'default' | 'amber' | 'danger'

export interface AppDialogChoice {
  id: string
  label: string
  /** Small control next to the choice (e.g. “Details”). */
  detailLabel?: string
  /** Expanded explanation when Details is opened. */
  detail?: string
}

export interface AppDialogProps {
  open: boolean
  kind?: AppDialogKind
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  /**
   * Chrome severity:
   * - amber — near Max FDP (≈MAX marker palette)
   * - danger — ≤30 min / over max or destructive (delete red)
   */
  tone?: AppDialogTone
  choices?: AppDialogChoice[]
  onConfirm: () => void
  onCancel?: () => void
  onChoose?: (id: string) => void
}

/**
 * Accessible modal dialog (replaces browser alert/confirm/prompt).
 */
export default function AppDialog({
  open,
  kind = 'alert',
  title,
  message,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  danger = false,
  tone = 'default',
  choices,
  onConfirm,
  onCancel,
  onChoose,
}: AppDialogProps) {
  const [openDetailId, setOpenDetailId] = useState<string | null>(null)

  if (!open) return null

  const resolvedTone: AppDialogTone =
    tone !== 'default' ? tone : danger ? 'danger' : 'default'
  const toneClass =
    resolvedTone === 'amber'
      ? ' is-tone-amber'
      : resolvedTone === 'danger'
        ? ' is-tone-danger'
        : ''

  return createPortal(
    <div
      className={`app-dialog-overlay${toneClass}`}
      role="presentation"
      onClick={() => {
        if (kind === 'alert') onConfirm()
        else onCancel?.()
      }}
    >
      <div
        className={`app-dialog${toneClass}`}
        role={kind === 'confirm' || kind === 'choice' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-body"
        data-tone={resolvedTone}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="app-dialog-title" className="app-dialog-title">
          {title}
        </h2>
        <p id="app-dialog-body" className="app-dialog-body">
          {message}
        </p>

        {kind === 'choice' && choices && choices.length > 0 && (
          <div className="app-dialog-choices" role="list">
            {choices.map((c) => {
              const hasDetail = !!(c.detail && c.detailLabel)
              const detailOpen = openDetailId === c.id
              return (
                <div key={c.id} className="app-dialog-choice-row" role="listitem">
                  <div className="app-dialog-choice-main">
                    <button
                      type="button"
                      className="app-dialog-btn app-dialog-btn-choice"
                      onClick={() => onChoose?.(c.id)}
                    >
                      {c.label}
                    </button>
                    {hasDetail && (
                      <button
                        type="button"
                        className="app-dialog-btn app-dialog-btn-detail"
                        aria-expanded={detailOpen}
                        onClick={() =>
                          setOpenDetailId((cur) =>
                            cur === c.id ? null : c.id,
                          )
                        }
                      >
                        {detailOpen ? 'Hide' : c.detailLabel}
                      </button>
                    )}
                  </div>
                  {hasDetail && detailOpen && (
                    <p className="app-dialog-choice-detail">{c.detail}</p>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="app-dialog-actions">
          {(kind === 'confirm' || kind === 'choice') && (
            <button
              type="button"
              className="app-dialog-btn app-dialog-btn-secondary"
              onClick={() => onCancel?.()}
            >
              {cancelLabel}
            </button>
          )}
          {kind !== 'choice' && (
            <button
              type="button"
              className={`app-dialog-btn app-dialog-btn-primary${
                resolvedTone === 'danger' || danger ? ' is-danger' : ''
              }${resolvedTone === 'amber' ? ' is-amber' : ''}`}
              onClick={onConfirm}
              autoFocus
            >
              {confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
