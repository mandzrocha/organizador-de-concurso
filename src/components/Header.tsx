'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { getUserId } from '@/lib/auth'
import { useTheme } from './ThemeProvider'
import { useDataChanged } from '@/lib/events'
import { matchEditalNews } from '@/lib/edital-news'
import { getDismissed, dismissAlert, alertId } from '@/lib/dismissed-alerts'
import { GlobalSearch } from './GlobalSearch'
import { Avatar } from './Avatar'
import type { NewsItem } from '@/app/api/news/route'
import type { Exam } from '@/lib/types'
import { Menu, Bell, Sun, Moon, LogOut, User, RotateCw, FileText, Check, Search, Flame, X } from 'lucide-react'

// Frase motivacional do dia (muda a cada dia, estável dentro do dia)
const PHRASES = [
  'Cada página estudada hoje é uma vaga mais perto.',
  'Disciplina vence talento quando o talento não tem disciplina.',
  'O edital não espera — mas você está se preparando.',
  'Constância vale mais que intensidade. Siga firme.',
  'Um pouco todo dia faz uma aprovação no fim do ano.',
  'A prova é dura, mas a sua rotina está te blindando.',
  'Quem revisa hoje, lembra na hora da prova.',
  'Foco no processo: a aprovação é consequência.',
  'Você já chegou mais longe do que ontem.',
  'Resolva mais uma questão. É sempre a próxima que conta.',
  'Não precisa ser perfeito, precisa ser constante.',
  'O concurso dos seus sonhos cabe na sua rotina.',
  'Cada erro corrigido hoje é um acerto garantido amanhã.',
  'A vaga é sua. Vá buscá-la, uma matéria por vez.',
]

function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0)
  return Math.floor((d.getTime() - start.getTime()) / 86400000)
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Bom dia'
  if (h < 18) return 'Boa tarde'
  return 'Boa noite'
}

interface Notif {
  id: string
  icon: React.ReactNode
  text: string
  sub?: string          // frase curta dando contexto
  href: string
  external?: boolean
  dismissKey?: string   // se preenchido, pode ser dispensada (marcada como lida)
}

export function Header({ onOpenMenu }: { onOpenMenu: () => void }) {
  const supabase = createClient()
  const router = useRouter()
  const { theme, toggle } = useTheme()
  const [email, setEmail] = useState<string | null>(null)
  const [name, setName] = useState<string>('')
  const [avatarUrl, setAvatarUrl] = useState<string>('')
  const [notifs, setNotifs] = useState<Notif[]>([])
  const [streak, setStreak] = useState(0)
  const [openMenu, setOpenMenu] = useState<null | 'bell' | 'profile'>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const phrase = PHRASES[dayOfYear() % PHRASES.length]
  const firstName = name.trim().split(/\s+/)[0]

  useEffect(() => {
    // nome salvo localmente (fallback imediato)
    const stored = typeof window !== 'undefined' ? localStorage.getItem('user-name') : null
    if (stored && stored !== 'Você') setName(stored)

    if (!isSupabaseConfigured()) return
    supabase.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? null)
      const meta: any = data.user?.user_metadata || {}
      const n: string | undefined = meta.full_name || meta.name
      if (n && n.trim()) {
        setName(n.trim())
        localStorage.setItem('user-name', n.trim()) // sincroniza com o Perfil
      }
      setAvatarUrl(meta.avatar_url || meta.picture || '')
    })
  }, [])

  useEffect(() => { loadNotifs(); loadStreak() }, [])
  useDataChanged(() => { loadNotifs(); loadStreak() })

  // Atalho Ctrl/Cmd+K abre a busca global
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  async function loadStreak() {
    if (!isSupabaseConfigured()) return
    const userId = await getUserId(supabase)
    if (!userId) return
    const { data } = await supabase.from('study_logs').select('studied_at').eq('user_id', userId).order('studied_at', { ascending: false }).limit(400)
    const days = new Set((data || []).map((l: any) => l.studied_at))
    let count = 0
    for (let i = 0; i < 400; i++) {
      const d = new Date(); d.setDate(d.getDate() - i)
      const ds = d.toISOString().split('T')[0]
      if (days.has(ds)) count++
      else if (i > 0) break // permite o dia de hoje ainda vazio
    }
    setStreak(count)
  }

  // Fecha dropdowns ao clicar fora / Esc
  useEffect(() => {
    if (!openMenu) return
    function onDoc(e: MouseEvent) { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpenMenu(null) }
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpenMenu(null) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [openMenu])

  async function loadNotifs() {
    if (!isSupabaseConfigured()) return
    const userId = await getUserId(supabase)
    if (!userId) return
    const today = new Date().toISOString().split('T')[0]
    const items: Notif[] = []

    // Revisões para hoje
    const { count } = await supabase.from('revision_schedule').select('id', { count: 'exact', head: true }).eq('user_id', userId).lte('next_review', today)
    if (count && count > 0) {
      items.push({
        id: 'reviews',
        icon: <RotateCw size={14} />,
        text: `${count} ${count === 1 ? 'revisão pendente' : 'revisões pendentes'} para hoje`,
        sub: 'Revisar no dia certo fixa o conteúdo antes de esquecer.',
        href: '/reviews',
      })
    }

    // Possível edital novo (concursos "de olho" ou pré-edital × notícias)
    try {
      const { data: enr } = await supabase.from('user_exams').select('is_watching, exam:exams(*)').eq('user_id', userId)
      const watchOrPre = (enr || [])
        .filter((r: any) => r.exam && (r.is_watching || !r.exam.exam_date))
        .map((r: any) => r.exam as Exam)
      if (watchOrPre.length > 0) {
        const res = await fetch('/api/news').then(r => r.json()).catch(() => null)
        const news: NewsItem[] = res?.items || []
        const matches = matchEditalNews(watchOrPre, news)
        const dismissed = getDismissed()
        for (const ex of watchOrPre) {
          const n = matches[ex.id]
          if (n && !dismissed.has(alertId(ex.id, n.link))) {
            items.push({
              id: 'edital-' + ex.id,
              icon: <FileText size={14} />,
              text: `Possível edital novo: ${ex.name}`,
              sub: 'Notícia menciona este concurso — confira na fonte oficial.',
              href: n.link,
              external: true,
              dismissKey: alertId(ex.id, n.link),
            })
          }
        }
      }
    } catch { /* ignora */ }

    setNotifs(items)
  }

  function dismissNotif(n: Notif) {
    if (!n.dismissKey) return
    dismissAlert(n.dismissKey)
    setNotifs(list => list.filter(x => x.id !== n.id))
  }

  function dismissAllNotifs() {
    for (const n of notifs) if (n.dismissKey) dismissAlert(n.dismissKey)
    setNotifs(list => list.filter(n => !n.dismissKey))
  }

  const dismissibleCount = notifs.filter(n => n.dismissKey).length

  async function signOut() {
    if (isSupabaseConfigured()) await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 h-14 border-b relative"
      style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border)' }}
    >
      {/* Esquerda: menu/logo (mobile) + saudação (desktop) */}
      <div className="flex items-center gap-2 min-w-0">
        <button onClick={onOpenMenu} className="lg:hidden w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ color: 'var(--text-muted)' }} aria-label="Abrir menu">
          <Menu size={20} />
        </button>
        <Link href="/dashboard" className="lg:hidden flex-shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="ConcurFlow" className="h-7 w-auto" />
        </Link>
        <div className="hidden lg:block min-w-0 leading-tight">
          <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{greeting()}{firstName ? `, ${firstName}` : ''} 👋</p>
          <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{phrase}</p>
        </div>
      </div>

      {/* Centro: busca global (centralizada na barra) */}
      <button
        onClick={() => setSearchOpen(true)}
        className="hidden sm:flex items-center gap-2 px-3 h-9 rounded-lg border text-sm transition-colors hover:bg-[var(--surface-hover)] absolute left-1/2 -translate-x-1/2 w-72"
        style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}
        title="Buscar (Ctrl+K)"
      >
        <Search size={15} />
        <span className="flex-1 text-left">Buscar...</span>
        <kbd className="text-[10px] px-1.5 py-0.5 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--text-subtle)' }}>Ctrl K</kbd>
      </button>

      {/* Direita: streak + ações */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {streak > 0 && (
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 h-9 rounded-lg mr-1" style={{ background: 'var(--surface-hover)' }} title="Dias seguidos estudando">
            <Flame size={15} style={{ color: 'var(--warning)' }} fill={streak >= 3 ? 'var(--warning)' : 'transparent'} />
            <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{streak}</span>
          </div>
        )}

      <div ref={wrapRef} className="flex items-center gap-1">
        {/* Busca (mobile: só ícone) */}
        <button onClick={() => setSearchOpen(true)} className="sm:hidden w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--text-muted)' }} aria-label="Buscar">
          <Search size={17} />
        </button>

        {/* Tema */}
        <button onClick={toggle} className="w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]" style={{ color: 'var(--text-muted)' }} title={theme === 'dark' ? 'Tema escuro' : 'Tema claro'} aria-label="Alternar tema">
          {theme === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
        </button>

        {/* Notificações */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(m => m === 'bell' ? null : 'bell')}
            className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]"
            style={{ color: 'var(--text-muted)' }}
            title="Notificações"
            aria-label="Notificações"
          >
            <Bell size={17} />
            {notifs.length > 0 && (
              <span className="absolute top-1.5 right-1.5 min-w-[15px] h-[15px] px-1 rounded-full text-[10px] font-bold flex items-center justify-center" style={{ background: 'var(--danger)', color: '#fff' }}>
                {notifs.length}
              </span>
            )}
          </button>
          {openMenu === 'bell' && (
            <div className="absolute right-0 mt-1 w-80 max-w-[90vw] rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="px-4 py-2.5 border-b flex items-center justify-between gap-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Notificações</span>
                {dismissibleCount > 0 && (
                  <button onClick={dismissAllNotifs} className="text-xs" style={{ color: 'var(--primary-strong)' }}>Marcar como lidas</button>
                )}
              </div>
              {notifs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  <Check size={20} className="mx-auto mb-1.5" style={{ color: 'var(--success)' }} />
                  Tudo em dia! Nenhuma notificação.
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto py-1">
                  {notifs.map(n => {
                    const inner = (
                      <>
                        <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>{n.icon}</span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm" style={{ color: 'var(--text)' }}>{n.text}</span>
                          {n.sub && <span className="block text-xs mt-0.5" style={{ color: 'var(--text-subtle)' }}>{n.sub}</span>}
                        </span>
                      </>
                    )
                    const cls = 'flex items-start gap-3 pl-4 pr-2 py-2.5 flex-1 min-w-0'
                    return (
                      <div key={n.id} className="flex items-start hover:bg-[var(--surface-hover)] transition-colors">
                        {n.external ? (
                          <a href={n.href} target="_blank" rel="noopener noreferrer" className={cls} onClick={() => setOpenMenu(null)}>{inner}</a>
                        ) : (
                          <Link href={n.href} className={cls} onClick={() => setOpenMenu(null)}>{inner}</Link>
                        )}
                        {n.dismissKey && (
                          <button onClick={() => dismissNotif(n)} className="w-7 h-7 mr-2 rounded-md flex items-center justify-center flex-shrink-0" style={{ color: 'var(--text-subtle)' }} title="Marcar como lida" aria-label="Dispensar">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Perfil */}
        <div className="relative">
          <button
            onClick={() => setOpenMenu(m => m === 'profile' ? null : 'profile')}
            className="ml-1 rounded-full transition-transform hover:scale-105"
            title="Conta"
            aria-label="Menu da conta"
          >
            <Avatar url={avatarUrl} label={name || email} size={36} />
          </button>
          {openMenu === 'profile' && (
            <div className="absolute right-0 mt-1 w-64 rounded-xl border overflow-hidden" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="px-4 py-3.5 border-b flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
                <Avatar url={avatarUrl} label={name || email} size={40} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: 'var(--text)' }}>{name || 'Você'}</p>
                  {email && <p className="text-xs truncate" style={{ color: 'var(--text-subtle)' }} title={email}>{email}</p>}
                </div>
              </div>
              <div className="py-1">
                <Link href="/profile" onClick={() => setOpenMenu(null)} className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-hover)]" style={{ color: 'var(--text)' }}>
                  <User size={15} style={{ color: 'var(--text-muted)' }} /> Meu perfil
                </Link>
                <button onClick={toggle} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--surface-hover)]" style={{ color: 'var(--text)' }}>
                  {theme === 'dark' ? <Moon size={15} style={{ color: 'var(--text-muted)' }} /> : <Sun size={15} style={{ color: 'var(--text-muted)' }} />}
                  Tema: {theme === 'dark' ? 'Escuro' : 'Claro'}
                </button>
                <button onClick={signOut} className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-[var(--danger-soft)]" style={{ color: 'var(--danger)' }}>
                  <LogOut size={15} /> Sair
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>

      <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />
    </header>
  )
}
