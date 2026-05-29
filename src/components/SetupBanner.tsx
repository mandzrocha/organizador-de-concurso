export function SetupBanner() {
  return (
    <div className="px-6 py-3 text-sm flex items-start gap-3" style={{ background: 'var(--warning-soft)', borderBottom: '1px solid var(--warning)' }}>
      <span>⚠️</span>
      <div style={{ color: 'var(--warning)' }}>
        <strong>Configuração necessária:</strong> Adicione suas credenciais do Supabase e Gemini no arquivo{' '}
        <code className="px-1 rounded text-xs" style={{ background: 'var(--surface-hover)' }}>.env.local</code>.
      </div>
    </div>
  )
}
