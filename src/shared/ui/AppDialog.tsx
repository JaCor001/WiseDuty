import { createPortal } from 'react-dom'
import './AppDialog.css'

export type AppDialogKind = 'alert' | 'confirm' | 'choice'

export interface AppDialogChoice {
  id: string
  label: string
}

export interface AppDialogProps {
  open: boolean
  kind?: AppDialogKind
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
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
  choices,
  onConfirm,
  onCancel,
  onChoose,
}: AppDialogProps) {
  if (!open) return null

  return createPortal(
    <div
      className="app-dialog-overlay"
      role="presentation"
      onClick={() => {
        if (kind === 'alert') onConfirm()
        else onCancel?.()
      }}
    >
      <div
        className="app-dialog"
        role={kind === 'confirm' || kind === 'choice' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-body"
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
            {choices.map((c) => (
              <button
                key={c.id}
                type="button"
                className="app-dialog-btn app-dialog-btn-choice"
                role="listitem"
                onClick={() => onChoose?.(c.id)}
              >
                {c.label}
              </button>
            ))}
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
              className={`app-dialog-btn app-dialog-btn-primary${danger ? ' is-danger' : ''}`}
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
