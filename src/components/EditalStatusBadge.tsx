import { EDITAL_STATUS_MAP } from '@/lib/types'

const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  muted:   { bg: 'var(--surface-hover)', fg: 'var(--text-muted)' },
  warning: { bg: 'var(--warning-soft)',  fg: 'var(--warning)' },
  primary: { bg: 'var(--primary-soft)',  fg: 'var(--primary-soft-text)' },
  success: { bg: 'var(--success-soft)',  fg: 'var(--success)' },
  danger:  { bg: 'var(--danger-soft)',   fg: 'var(--danger)' },
}

export function EditalStatusBadge({ status }: { status: string | null }) {
  const meta = status ? EDITAL_STATUS_MAP[status] : null
  if (!meta) return null
  const tone = STATUS_TONE[meta.tone] || STATUS_TONE.muted
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: tone.bg, color: tone.fg }}>{meta.label}</span>
  )
}
