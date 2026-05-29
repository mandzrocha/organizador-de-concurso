'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { RevisionSchedule, Topic, Subject, ActivityType, ACTIVITY_LABELS } from '@/lib/types'
import { sm2 } from '@/lib/sm2'
import { isSupabaseConfigured } from '@/lib/config'
import { format, parseISO, differenceInDays } from 'date-fns'
import { ptBR } from 'date-fns/locale'

type RevWithTopic = RevisionSchedule & { topic: Topic & { subject: Subject } }

const QUALITY_OPTIONS = [
  { value: 5, label: 'Fácil demais', color: '#22c55e', desc: 'Lembro muito bem' },
  { value: 4, label: 'Bom', color: '#84cc16', desc: 'Lembro bem' },
  { value: 3, label: 'Regular', color: '#eab308', desc: 'Lembro com esforço' },
  { value: 2, label: 'Difícil', color: '#f97316', desc: 'Esqueci bastante' },
  { value: 1, label: 'Muito difícil', color: '#ef4444', desc: 'Não lembrei' },
]

export default function ReviewsPage() {
  const supabase = createClient()
  const [reviews, setReviews] = useState<RevWithTopic[]>([])
  const [upcoming, setUpcoming] = useState<RevWithTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [doing, setDoing] = useState<RevWithTopic | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { loadReviews() }, [])

  async function loadReviews() {
    if (!isSupabaseConfigured()) { setLoading(false); return }
    const today = new Date().toISOString().split('T')[0]
    const in7days = new Date(); in7days.setDate(in7days.getDate() + 7)

    const [dueRes, upcomingRes] = await Promise.all([
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .lte('next_review', today)
        .order('next_review'),
      supabase.from('revision_schedule')
        .select('*, topic:topics(*, subject:subjects(*))')
        .gt('next_review', today)
        .lte('next_review', in7days.toISOString().split('T')[0])
        .order('next_review')
        .limit(20),
    ])

    setReviews((dueRes.data || []) as RevWithTopic[])
    setUpcoming((upcomingRes.data || []) as RevWithTopic[])
    setLoading(false)
  }

  async function submitReview(quality: number) {
    if (!doing) return
    setSaving(true)
    const result = sm2(quality, doing.repetitions, doing.ease_factor, doing.interval_days)
    await supabase.from('revision_schedule').update({
      ...result,
      last_reviewed: new Date().toISOString().split('T')[0],
    }).eq('id', doing.id)
    await supabase.from('study_logs').insert({
      topic_id: doing.topic_id,
      activity_type: 'review' as ActivityType,
      studied_at: new Date().toISOString().split('T')[0],
    })
    setSaving(false)
    setDoing(null)
    loadReviews()
  }

  if (loading) return <div className="flex items-center justify-center h-full" style={{ color: '#8888a0' }}><p className="text-sm">Carregando...</p></div>

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold" style={{ color: '#e8e8f0' }}>Revisões</h1>
        <p className="text-sm mt-0.5" style={{ color: '#8888a0' }}>Sistema de repetição espaçada (SM-2)</p>
      </div>

      {/* Due reviews */}
      <section>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-sm font-medium" style={{ color: '#8888a0' }}>Para revisar hoje</h2>
          {reviews.length > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium" style={{ background: '#2a1a1a', color: '#f87171' }}>
              {reviews.length}
            </span>
          )}
        </div>

        {reviews.length === 0 ? (
          <div className="rounded-xl border p-8 text-center" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
            <div className="text-3xl mb-2">🎉</div>
            <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>Nenhuma revisão pendente!</p>
            <p className="text-xs mt-1" style={{ color: '#8888a0' }}>Você está em dia com suas revisões.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {reviews.map(rev => {
              const overdue = rev.next_review ? differenceInDays(new Date(), parseISO(rev.next_review)) : 0
              return (
                <div
                  key={rev.id}
                  className="rounded-xl border flex items-center gap-4 px-4 py-3"
                  style={{ background: '#17171f', borderColor: doing?.id === rev.id ? '#6366f1' : '#2a2a38' }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{rev.topic?.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-xs" style={{ color: '#8888a0' }}>
                      <span>{rev.topic?.subject?.name}</span>
                      {overdue > 0 && <span style={{ color: '#f87171' }}>· {overdue}d de atraso</span>}
                      <span>· {rev.repetitions} repetições</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setDoing(rev)}
                    className="text-xs px-3 py-1.5 rounded-lg font-medium"
                    style={{ background: '#1e1e30', color: '#818cf8' }}
                  >
                    Revisar
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <section>
          <h2 className="text-sm font-medium mb-3" style={{ color: '#8888a0' }}>Próximos 7 dias</h2>
          <div className="space-y-2">
            {upcoming.map(rev => (
              <div key={rev.id} className="rounded-xl border flex items-center gap-4 px-4 py-3" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: '#c8c8e0' }}>{rev.topic?.name}</p>
                  <p className="text-xs mt-0.5" style={{ color: '#8888a0' }}>{rev.topic?.subject?.name}</p>
                </div>
                <p className="text-xs flex-shrink-0" style={{ color: '#8888a0' }}>
                  {rev.next_review ? format(parseISO(rev.next_review), "d MMM", { locale: ptBR }) : '—'}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Review modal */}
      {doing && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.8)' }}>
          <div className="w-full max-w-md rounded-2xl border p-6 space-y-5" style={{ background: '#17171f', borderColor: '#2a2a38' }}>
            <div>
              <p className="text-xs mb-1" style={{ color: '#8888a0' }}>{doing.topic?.subject?.name}</p>
              <h2 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>{doing.topic?.name}</h2>
              <p className="text-xs mt-1" style={{ color: '#555568' }}>
                Última revisão: {doing.last_reviewed ? format(parseISO(doing.last_reviewed), "d 'de' MMM", { locale: ptBR }) : 'Nunca'}
                · Intervalo atual: {doing.interval_days} dias
              </p>
            </div>

            <div className="p-4 rounded-xl text-sm" style={{ background: '#1e1e28', color: '#8888a0' }}>
              Avalie sua memorização deste tópico:
            </div>

            <div className="space-y-2">
              {QUALITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => !saving && submitReview(opt.value)}
                  disabled={saving}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all hover:border-opacity-80 disabled:opacity-50"
                  style={{ borderColor: '#2a2a38', background: '#1e1e28' }}
                >
                  <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: opt.color }} />
                  <div>
                    <p className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{opt.label}</p>
                    <p className="text-xs" style={{ color: '#8888a0' }}>{opt.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            <button onClick={() => setDoing(null)} className="w-full text-sm" style={{ color: '#555568' }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  )
}
