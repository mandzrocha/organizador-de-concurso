'use client'

/**
 * Skeleton de carregamento. Substitui o "Carregando..." cru para reduzir a
 * sensação de lentidão nas páginas com várias queries (dashboard etc.).
 */
export function Skeleton({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`ef-skeleton rounded-lg ${className}`}
      style={{ background: 'var(--surface-hover)', ...style }}
    />
  )
}

export function PageSkeleton({ variant = 'default' }: { variant?: 'default' | 'list' | 'detail' }) {
  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>
      {variant === 'detail' && (
        <Skeleton className="h-28 w-full rounded-2xl" />
      )}
      <div className={variant === 'default' ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : 'space-y-3'}>
        {variant === 'default' ? (
          <>
            <div className="lg:col-span-2 space-y-4">
              <Skeleton className="h-40 w-full rounded-2xl" />
              <Skeleton className="h-32 w-full rounded-2xl" />
            </div>
            <div className="space-y-4">
              <Skeleton className="h-32 w-full rounded-2xl" />
              <Skeleton className="h-24 w-full rounded-2xl" />
            </div>
          </>
        ) : (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-2xl" />
          ))
        )}
      </div>
    </div>
  )
}
