'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { isSupabaseConfigured } from '@/lib/config'
import { Mail, Lock, Loader2, GraduationCap, CheckCircle2, Eye, EyeOff, User } from 'lucide-react'

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
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmSent, setConfirmSent] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [remember, setRemember] = useState(true)
  const [googleLoading, setGoogleLoading] = useState(false)

  const configured = isSupabaseConfigured()

  async function signInWithGoogle() {
    if (!configured) { setError('Supabase não está configurado (.env.local).'); return }
    setError(null)
    setGoogleLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) throw error
      // redireciona para o Google; não precisa fazer mais nada aqui
    } catch (err: any) {
      setError(traduzErro(err?.message || 'Não foi possível entrar com o Google.'))
      setGoogleLoading(false)
    }
  }

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
        const name = fullName.trim()
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
            data: { full_name: name },
          },
        })
        if (error) throw error
        if (name) localStorage.setItem('user-name', name)
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
        {mode === 'signup' && (
          <div>
            <label className="text-xs block mb-1.5" style={{ color: 'var(--text-muted)' }}>Nome</label>
            <div className="relative">
              <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-subtle)' }} />
              <input
                type="text"
                required
                autoComplete="name"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Como quer ser chamado(a)"
                style={{ paddingLeft: 36 }}
              />
            </div>
          </div>
        )}

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
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres"
              style={{ paddingLeft: 36, paddingRight: 38 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword(s => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center transition-colors hover:bg-[var(--surface-hover)]"
              style={{ color: 'var(--text-subtle)' }}
              title={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={remember}
            onChange={e => setRemember(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--primary-strong)' }}
          />
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Manter-me conectado</span>
        </label>

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

      <div className="flex items-center gap-3 my-4">
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--text-subtle)' }}>ou</span>
        <div className="flex-1 h-px" style={{ background: 'var(--border)' }} />
      </div>

      <button
        type="button"
        onClick={signInWithGoogle}
        disabled={googleLoading}
        className="w-full py-2.5 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-2.5 border transition-colors disabled:opacity-50 hover:bg-[var(--surface-hover)]"
        style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {googleLoading ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
            <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.211 35.091 26.715 36 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303c-.792 2.237-2.231 4.166-4.087 5.571.001-.001 6.19 5.238 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
          </svg>
        )}
        Continuar com Google
      </button>

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
