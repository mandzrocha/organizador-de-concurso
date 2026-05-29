@AGENTS.md

# EditalFocus — visão geral do projeto

Plataforma **pessoal** (usuário único, sem login/autenticação) para organizar estudos
para concursos públicos brasileiros. O usuário sobe o PDF do edital, a IA extrai as
matérias e tópicos, e o app acompanha o estudo com repetição espaçada e um calendário.

## Stack

- **Next.js 16.2.6** (App Router) + React 19 + TypeScript — ⚠️ versão com breaking
  changes; veja `AGENTS.md` e consulte `node_modules/next/dist/docs/` antes de codar.
- **Supabase** (Postgres) — acesso pelo cliente browser (`@supabase/ssr`) usando a
  chave `anon`. RLS está **desativado** (app pessoal) — veja `supabase-disable-rls.sql`.
- **Google Gemini** (`@google/generative-ai`, modelo `gemini-3.5-flash`) para a IA.
  Já migramos do Anthropic/Claude para o Gemini.
- **pdf-parse@1.1.1** (CommonJS) para extrair texto dos PDFs.
- **Tailwind CSS v4**. Deploy pensado para Vercel.

## Variáveis de ambiente (`.env.local` — NÃO está no Git, recriar a cada máquina)

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
GEMINI_API_KEY=...
```

## Como rodar

```
npm install
npm run dev        # porta padrão; neste projeto há launch.json usando porta 3001
```

Antes de usar o banco pela primeira vez numa conta Supabase nova: rode
`supabase-schema.sql` e depois `supabase-disable-rls.sql` no SQL Editor do Supabase.

## Estrutura

- `src/app/(app)/` — páginas autenticadas (layout é **server component** que exporta
  `dynamic = 'force-dynamic'` e envolve o `Sidebar` client):
  - `dashboard/`, `exams/`, `exams/new/`, `exams/[id]/`, `exams/[id]/edit/`,
    `calendar/`, `reviews/`
- `src/app/api/` — rotas de API (Node runtime, `maxDuration = 60`):
  - `extract-edital/` — extrai matérias/tópicos do PDF via Gemini
  - `compare-edital/` — diff entre edital novo e o já cadastrado (status new/existing/removed)
  - `generate-schedule/` — gera cronograma de estudos com IA
- `src/lib/`:
  - `pdf.ts` — `extractTextFromPdf`; usa `require('pdf-parse/lib/pdf-parse.js')`
    (importar o arquivo interno evita o bug que tenta abrir um PDF de teste).
  - `sm2.ts` — algoritmo de repetição espaçada SM-2.
  - `config.ts` — `isSupabaseConfigured()`: guarda usada no início de TODO carregamento
    de dados para evitar travar quando as credenciais são placeholders.
  - `types.ts` — tipos e constantes (ActivityType, ACTIVITY_LABELS/ICONS, SUBJECT_COLORS).
  - `progress.ts`, `supabase/client.ts`, `supabase/server.ts`.
- `src/components/` — `Sidebar.tsx` (client, usePathname), `SetupBanner.tsx`.

## Modelo de dados (Supabase)

Tabelas: `exams`, `subjects`, `exam_subjects` (N:N), `topics`, `study_logs`,
`revision_schedule` (SM-2), `calendar_plans`. Schema completo em `supabase-schema.sql`.

Conceitos:
- **Matérias compartilhadas**: `subjects` podem ser reutilizadas entre concursos;
  tópicos específicos de um concurso usam `topics.exam_id`.
- **Pré-edital**: concurso sem data de prova → `exams.exam_date = null`. A UI infere o
  estado "pré-edital" pela data nula (sem coluna extra). Usado quando ainda não saiu o
  edital e o usuário estuda pelo edital do ano anterior.
- **4 tipos de atividade** por tópico: `video`, `exercises`, `reading`, `review`.

## Decisões/pegadinhas importantes

- **Extração de edital**: o texto do PDF inteiro é enviado ao Gemini (até ~400k chars),
  pois o conteúdo programático costuma estar no FIM de PDFs grandes (ex.: Diário da
  Justiça). As rotas usam `generationConfig` com `responseMimeType: 'application/json'`
  e `maxOutputTokens` alto para não truncar a lista. O prompt instrui a achar a seção do
  programa no meio do "lixo" e a tratar disciplinas dentro de "BLOCOS" como matérias
  separadas. Validado com o edital TJSP Escrevente 2025 (11 matérias extraídas).
- **Layout server + Sidebar client**: só server components podem exportar `dynamic`.
- **Guard `isSupabaseConfigured()`**: sem ele, credenciais placeholder geram requests que
  dão timeout (não lançam erro) e a página fica presa em "Carregando...".

## Estado atual

Funcional: criação de concurso com extração de edital por IA, dashboard, calendário,
revisões (SM-2), edição de concurso com comparação de editais. Projeto no GitHub:
`https://github.com/mandzrocha/organizador-de-concurso` (branch `main`).
