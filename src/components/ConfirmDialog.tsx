'use client'

import { createContext, useCallback, useContext, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn>(async () => false)

export function useConfirm() {
  return useContext(ConfirmContext)
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null)

  const confirm = useCallback<ConfirmFn>((opts) => {
    return new Promise<boolean>(resolve => {
      setPending({ ...opts, resolve })
    })
  }, [])

  function close(result: boolean) {
    if (pending) pending.resolve(result)
    setPending(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
          onClick={e => e.target === e.currentTarget && close(false)}
        >
          <div className="w-full max-w-sm rounded-2xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: pending.danger ? 'var(--danger-soft)' : 'var(--primary-soft)', color: pending.danger ? 'var(--danger)' : 'var(--primary)' }}
                >
                  <AlertTriangle size={18} />
                </span>
                <div className="flex-1 min-w-0">
                  <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>{pending.title}</h2>
                  {pending.message && (
                    <p className="text-sm mt-1 whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>{pending.message}</p>
                  )}
                </div>
                <button onClick={() => close(false)} className="flex-shrink-0" style={{ color: 'var(--text-subtle)' }}><X size={18} /></button>
              </div>
            </div>
            <div className="px-5 pb-5 flex gap-3">
              <button
                onClick={() => close(false)}
                className="flex-1 py-2.5 rounded-xl text-sm border"
                style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
              >
                {pending.cancelLabel ?? 'Cancelar'}
              </button>
              <button
                onClick={() => close(true)}
                autoFocus
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: pending.danger ? 'var(--danger)' : 'var(--primary-strong)', color: '#fff' }}
              >
                {pending.confirmLabel ?? 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}
