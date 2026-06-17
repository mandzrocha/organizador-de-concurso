'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { Mail, Lock, Loader2, GraduationCap, CheckCircle2 } from 'lucide-react'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get('next') || '/dashboard'

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)

  const configured = isSupabaseConfigured()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!configured) {
      setError('Supabase não está configurado (.env.local).')
      return
    }
    setError(null)
    setLoading(true)
    const supabase = createClient()

    try {
      if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
        })
        if (error) throw error
        // Se a confirmação de e-mail estiver ligada, não há sessão ainda.
        if (data.session) {
          router.push(next)
          router.refresh()
        } else {
          setConfirmSent(true)
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        })
        if (error) throw error
        router.push(next)
        router.refresh()
      }
    } catch (err: any) {
      setError(traduzErro(err?.message || 'Algo deu errado. Tente novamente.'))
    } finally {
      setLoading(false)
    }
  }

  if (confirmSent) {
    return (
      <Shell>
        <div className="text-center">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-4" style={{ background: 'var(--success-soft)', color: 'var(--success)' }}>
            <CheckCircle2 size={24} />
          </div>
          <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--text)' }}>Confirme seu e-mail</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            Enviamos um link de confirmação para <strong style={{ color: 'var(--text)' }}>{email}</strong>.
            Abra o e-mail e clique no link para ativar sua conta.
          </p>
          <button
            onClick={() => { setConfirmSent(false); setMode('signin') }}
            className="text-sm mt-5 font-medium"
            style={{ color: 'var(--primary)' }}
          >
            Voltar para o login
          </button>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="text-center mb-6">
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}>
          <GraduationCap size={26} />
        </div>
        <h1 className="text-xl font-semibold" style={{ color: 'var(--text)' }}>
          {mode === 'signin' ? 'Entrar no ConcurFlow' : 'Criar sua conta'}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {mode === 'signin' ? 'Organize seus estudos para concursos' : 'Comece a organizar seus estudos'}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>E-mail</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} />
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="voce@email.com"
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>

        <div>
          <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Senha</label>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} />
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              style={{ paddingLeft: 36 }}
            />
          </div>
        </div>

        {error && (
          <p className="text-xs px-3 py-2 rounded-lg" style={{ background: 'var(--danger-soft)', color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 disabled:opacity-50"
          style={{ background: 'var(--primary-strong)', color: '#fff' }}
        >
          {loading && <Loader2 size={15} className="animate-spin" />}
          {mode === 'signin' ? 'Entrar' : 'Criar conta'}
        </button>
      </form>

      <p className="text-sm text-center mt-5" style={{ color: 'var(--text-muted)' }}>
        {mode === 'signin' ? 'Ainda não tem conta?' : 'Já tem conta?'}{' '}
        <button
          onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError(null) }}
          className="font-medium"
          style={{ color: 'var(--primary)' }}
        >
          {mode === 'signin' ? 'Criar conta' : 'Entrar'}
        </button>
      </p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg)' }}>
      <div className="w-full max-w-sm rounded-2xl border p-7" style={{ background: 'var(--surface)', borderColor: 'var(--border)', boxShadow: 'var(--shadow-lg)' }}>
        {children}
      </div>
    </div>
  )
}

function traduzErro(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('user already registered')) return 'Já existe uma conta com este e-mail. Tente entrar.'
  if (m.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar (verifique sua caixa de entrada).'
  if (m.includes('unable to validate email')) return 'E-mail inválido.'
  return msg
}
