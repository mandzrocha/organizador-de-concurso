'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Check, AlertTriangle, Info, X, RotateCcw } from 'lucide-react'

type ToastVariant = 'success' | 'error' | 'info'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
  action?: ToastAction
}

interface ToastApi {
  success: (message: string, opts?: { action?: ToastAction; duration?: number }) => void
  error: (message: string, opts?: { action?: ToastAction; duration?: number }) => void
  info: (message: string, opts?: { action?: ToastAction; duration?: number }) => void
}

const ToastContext = createContext<ToastApi>({
  success: () => {}, error: () => {}, info: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

let nextId = 1

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) { clearTimeout(timer); timers.current.delete(id) }
  }, [])

  const push = useCallback((variant: ToastVariant, message: string, opts?: { action?: ToastAction; duration?: number }) => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, variant, action: opts?.action }])
    // Ações (ex.: Desfazer) ficam mais tempo na tela.
    const duration = opts?.duration ?? (opts?.action ? 7000 : 3500)
    const timer = setTimeout(() => dismiss(id), duration)
    timers.current.set(id, timer)
  }, [dismiss])

  useEffect(() => {
    const map = timers.current
    return () => { map.forEach(clearTimeout); map.clear() }
  }, [])

  const api: ToastApi = {
    success: (m, o) => push('success', m, o),
    error: (m, o) => push('error', m, o),
    info: (m, o) => push('info', m, o),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 'calc(100vw - 2rem)' }}>
        {toasts.map(t => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

const VARIANT_META: Record<ToastVariant, { Icon: typeof Check; color: string; soft: string }> = {
  success: { Icon: Check, color: 'var(--success)', soft: 'var(--success-soft)' },
  error: { Icon: AlertTriangle, color: 'var(--danger)', soft: 'var(--danger-soft)' },
  info: { Icon: Info, color: 'var(--primary)', soft: 'var(--primary-soft)' },
}

function ToastCard({ toast, onDismiss }: { toast: ToastItem; onDismiss: () => void }) {
  const { Icon, color, soft } = VARIANT_META[toast.variant]
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])

  return (
    <div
      className="pointer-events-auto flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-xl border min-w-[280px] transition-all"
      style={{
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: 'var(--shadow-lg)',
        transform: entered ? 'translateX(0)' : 'translateX(120%)',
        opacity: entered ? 1 : 0,
      }}
      role="status"
    >
      <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: soft, color }}>
        <Icon size={15} strokeWidth={2.5} />
      </span>
      <p className="flex-1 text-sm" style={{ color: 'var(--text)' }}>{toast.message}</p>
      {toast.action && (
        <button
          onClick={() => { toast.action!.onClick(); onDismiss() }}
          className="text-xs font-semibold px-2 py-1 rounded-md inline-flex items-center gap-1 flex-shrink-0"
          style={{ color: 'var(--primary)', background: 'var(--primary-soft)' }}
        >
          <RotateCcw size={12} /> {toast.action.label}
        </button>
      )}
      <button onClick={onDismiss} className="w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0" style={{ color: 'var(--text-subtle)' }} title="Fechar">
        <X size={14} />
      </button>
    </div>
  )
}
