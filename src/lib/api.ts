// Lê a resposta de uma rota de API de forma SEGURA.
// Rotas podem falhar na plataforma (timeout/crash) e devolver TEXTO/HTML em vez
// de JSON — nesse caso `res.json()` estoura com "Unexpected token ...". Aqui a
// gente lê como texto, tenta parsear, e sempre lança um Error com mensagem legível.
export async function parseJsonResponse(res: Response): Promise<any> {
  const raw = await res.text()
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch { /* corpo não é JSON */ }

  if (res.ok && data) return data

  // Erro estruturado da própria rota (melhor caso)
  if (data?.error) throw new Error(data.error)

  // Timeout / gateway / indisponível — resposta não-JSON da plataforma
  if ([408, 502, 503, 504].includes(res.status)) {
    throw new Error(
      'O servidor demorou demais para processar o edital e interrompeu. ' +
      'Tente enviar só as páginas do conteúdo programático (como fotos), ou tente novamente.'
    )
  }

  // Qualquer outra coisa: mostra um trecho do corpo (sem tags HTML) pra dar pista
  const hint = (raw || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160)
  throw new Error(`Falha na extração${res.status ? ` (erro ${res.status})` : ''}.${hint ? ' ' + hint : ''}`)
}
