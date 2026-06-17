import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ConcurFlow — Estudos para Concursos',
  description: 'Plataforma centralizada de estudos para concursos públicos',
  icons: { icon: '/logo.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full" data-theme="light">
      <head>
        {/* Aplica o tema salvo (padrão claro) antes da pintura — evita flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.setAttribute('data-theme',localStorage.getItem('theme')||'light')}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
