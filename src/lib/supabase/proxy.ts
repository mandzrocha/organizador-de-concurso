import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isSupabaseConfigured } from '@/lib/config'

// Rotas que não exigem login.
const PUBLIC_PREFIXES = ['/login', '/auth']

/**
 * Refresca a sessão do Supabase em cada request (mantém o cookie válido) e
 * protege as rotas do app: visitante sem sessão é mandado pro /login.
 * Padrão recomendado do @supabase/ssr, adaptado ao convention `proxy` do Next 16.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  // Sem credenciais reais (placeholders) → não bloqueia nada; o app mostra o
  // banner de configuração normalmente.
  if (!isSupabaseConfigured()) return response

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // IMPORTANTE: getUser() revalida o token no servidor (não confie só no cookie).
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isPublic = PUBLIC_PREFIXES.some(p => path === p || path.startsWith(p + '/'))

  if (!user && !isPublic) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = ''
    url.searchParams.set('next', path)
    return NextResponse.redirect(url)
  }

  // Já logado tentando abrir o /login → vai direto pro dashboard.
  if (user && path === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}
