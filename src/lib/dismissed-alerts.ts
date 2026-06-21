// Avisos de "possível edital novo" que o usuário dispensou (X). Guardado no
// navegador. A chave inclui o link da notícia, então um edital NOVO do mesmo
// concurso volta a aparecer.
const KEY = 'edital-alerts-dismissed'

export function alertId(examId: string, newsLink: string): string {
  return `${examId}|${newsLink}`
}

export function getDismissed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')) } catch { return new Set() }
}

export function dismissAlert(id: string): void {
  const s = getDismissed()
  s.add(id)
  localStorage.setItem(KEY, JSON.stringify([...s]))
}
