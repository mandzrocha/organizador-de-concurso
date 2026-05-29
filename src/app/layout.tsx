import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'EditalFocus — Estudos para Concursos',
  description: 'Plataforma centralizada de estudos para concursos públicos',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
