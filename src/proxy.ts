import { type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'

// Next 16: o antigo `middleware` virou `proxy`. Aqui ele só refresca a sessão
// do Supabase e protege as rotas (a lógica fica em lib/supabase/proxy).
export async function proxy(request: NextRequest) {
  return await updateSession(request)
}

export const config = {
  matcher: [
    /*
     * Roda em tudo, EXCETO:
     * - /api (rotas de API têm sua própria lógica)
     * - assets do Next (_next/static, _next/image)
     * - arquivos estáticos (favicon, logo, imagens)
     */
    '/((?!api|_next/static|_next/image|favicon.ico|logo.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
