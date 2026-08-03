import { useCallback, useRef, useState } from 'react'

export type DialogState =
  | {
      kind: 'alert'
      title: string
      message: string
      confirmLabel?: string
      onConfirm: () => void
    }
  | {
      kind: 'confirm'
      title: string
      message: string
      confirmLabel?: string
      cancelLabel?: string
      danger?: boolean
      onConfirm: () => void
      onCancel: () => void
    }
  | {
      kind: 'choice'
      title: string
      message: string
      choices: { id: string; label: string }[]
      onChoose: (id: string) => void
      onCancel: () => void
    }

/**
 * Promise-based in-app dialogs (replaces window.alert / confirm / prompt).
 */
export function useAppDialog() {
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const seq = useRef(0)

  const close = useCallback(() => setDialog(null), [])

  const showAlert = useCallback((title: string, message: string) => {
    return new Promise<void>((resolve) => {
      setDialog({
        kind: 'alert',
        title,
        message,
        onConfirm: () => {
          setDialog(null)
          resolve()
        },
      })
    })
  }, [])

  const showConfirm = useCallback(
    (
      title: string,
      message: string,
      opts?: { confirmLabel?: string; cancelLabel?: string; danger?: boolean },
    ) => {
      return new Promise<boolean>((resolve) => {
        setDialog({
          kind: 'confirm',
          title,
          message,
          confirmLabel: opts?.confirmLabel,
          cancelLabel: opts?.cancelLabel,
          danger: opts?.danger,
          onConfirm: () => {
            setDialog(null)
            resolve(true)
          },
          onCancel: () => {
            setDialog(null)
            resolve(false)
          },
        })
      })
    },
    [],
  )

  const showChoice = useCallback(
    (
      title: string,
      message: string,
      choices: { id: string; label: string }[],
    ) => {
      return new Promise<string | null>((resolve) => {
        const id = ++seq.current
        void id
        setDialog({
          kind: 'choice',
          title,
          message,
          choices,
          onChoose: (choiceId) => {
            setDialog(null)
            resolve(choiceId)
          },
          onCancel: () => {
            setDialog(null)
            resolve(null)
          },
        })
      })
    },
    [],
  )

  return { dialog, setDialog, close, showAlert, showConfirm, showChoice }
}
