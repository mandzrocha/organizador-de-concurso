export function SetupBanner() {
  return (
    <div className="px-6 py-3 text-sm flex items-start gap-3" style={{ background: '#1a1a10', borderBottom: '1px solid #3a3a10' }}>
      <span>⚠️</span>
      <div style={{ color: '#c8b860' }}>
        <strong>Configuração necessária:</strong> Adicione suas credenciais do Supabase e Anthropic no arquivo{' '}
        <code className="px-1 rounded text-xs" style={{ background: '#2a2a10' }}>.env.local</code>.
        Veja o <strong>README de configuração</strong> abaixo.
      </div>
    </div>
  )
}
