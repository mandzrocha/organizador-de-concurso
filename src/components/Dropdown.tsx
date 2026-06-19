'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

export interface DropdownOption {
  value: string
  label: string
  color?: string   // bolinha opcional (ex.: cor da matéria)
}

/**
 * Dropdown customizado: ao contrário do <select> nativo, o popup tem a
 * largura do campo e TRUNCA rótulos longos (nomes de tópico gigantes não
 * estouram a tela). Fecha ao clicar fora ou apertar Esc.
 */
export function Dropdown({ value, onChange, options, placeholder, disabled }: {
  value: string
  onChange: (v: string) => void
  options: DropdownOption[]
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const selected = options.find(o => o.value === value)

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ borderColor: open ? 'var(--primary)' : 'var(--border)', background: 'var(--surface)', color: selected && selected.value ? 'var(--text)' : 'var(--text-subtle)' }}
      >
        {selected?.color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: selected.color }} />}
        <span className="flex-1 truncate">{selected ? selected.label : (placeholder || 'Selecione')}</span>
        <ChevronDown size={14} style={{ color: 'var(--text-subtle)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} className="flex-shrink-0" />
      </button>
      {open && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-y-auto rounded-lg border py-1"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}
        >
          {options.map(o => (
            <button
              key={o.value}
              type="button"
              title={o.label}
              onClick={() => { onChange(o.value); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text)', background: o.value === value ? 'var(--surface-hover)' : undefined }}
            >
              {o.color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: o.color }} />}
              <span className="flex-1 truncate">{o.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
