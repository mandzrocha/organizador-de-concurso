// Avatar: mostra a foto (se houver) ou a inicial do nome num círculo com gradiente.
export function Avatar({ url, label, size = 36, className = '' }: {
  url?: string | null
  label?: string | null
  size?: number
  className?: string
}) {
  const initial = (label || '?').trim().charAt(0).toUpperCase() || '?'
  if (url) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={label || 'avatar'}
        width={size}
        height={size}
        className={`rounded-full object-cover flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className={`rounded-full flex items-center justify-center font-semibold flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background: 'linear-gradient(135deg, var(--primary-strong), var(--primary))',
        color: '#fff',
        fontSize: Math.round(size * 0.42),
      }}
    >
      {initial}
    </span>
  )
}
