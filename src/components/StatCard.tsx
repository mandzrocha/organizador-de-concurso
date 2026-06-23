import type { ReactNode } from 'react'

/**
 * Card de número padrão do app — use SEMPRE este componente para "big numbers"
 * (métricas/KPIs) para que todas as telas fiquem visualmente iguais.
 *
 * Layout: caixinha colorida com ícone no topo, número grande e label abaixo.
 * - `dim`: mostra o card "apagado" (cinza) quando o valor é zero/vazio.
 * - `onClick`: torna o card clicável (com realce ao passar o mouse).
 */
export function StatCard({
  icon,
  label,
  value,
  sub,
  accent = 'var(--primary)',
  soft = 'var(--primary-soft)',
  onClick,
  dim = false,
}: {
  icon?: ReactNode
  label: string
  value: ReactNode
  sub?: string
  accent?: string
  soft?: string
  onClick?: () => void
  dim?: boolean
}) {
  const clickable = !!onClick
  const Tag: any = clickable ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`ef-card p-4 sm:p-5 text-left w-full block ${clickable ? 'ef-hover-lift cursor-pointer' : ''}`}
    >
      {icon != null && (
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center mb-3"
          style={{ background: dim ? 'var(--surface-hover)' : soft, color: dim ? 'var(--text-subtle)' : accent }}
        >
          {icon}
        </div>
      )}
      <p className="text-2xl sm:text-3xl font-bold tabular-nums leading-none" style={{ color: dim ? 'var(--text-subtle)' : 'var(--text)' }}>
        {value}
      </p>
      <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>{label}</p>
      {sub && <p className="text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{sub}</p>}
    </Tag>
  )
}
