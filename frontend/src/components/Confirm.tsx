import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/** An in-app replacement for window.confirm(), in the app's own style. */
export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** styles the confirm button as destructive */
  danger?: boolean
}

type Ask = (options: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Ask>(async () => false)

export function useConfirm(): Ask {
  return useContext(ConfirmContext)
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)

  const ask = useCallback<Ask>((options) => new Promise((resolve) => setPending({ ...options, resolve })), [])

  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }

  useEffect(() => {
    if (!pending) return
    confirmButton.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {pending && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div className="modal confirm-dialog" role="alertdialog" aria-label={pending.title}>
            <header>
              <h2>{pending.title}</h2>
            </header>
            {pending.body && <div className="confirm-body">{pending.body}</div>}
            <footer>
              <span className="spacer" />
              <button className="secondary" onClick={() => close(false)}>{pending.cancelLabel ?? 'Cancel'}</button>
              <button ref={confirmButton} className={pending.danger ? 'danger-fill' : 'primary'} onClick={() => close(true)}>
                {pending.confirmLabel ?? 'OK'}
              </button>
            </footer>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
