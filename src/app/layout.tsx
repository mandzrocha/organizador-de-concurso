import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ConcurFlow — Estudos para Concursos',
  description: 'Plataforma centralizada de estudos para concursos públicos',
  icons: { icon: '/logo-symbol.svg' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
