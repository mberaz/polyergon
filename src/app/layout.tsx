import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Polyergon',
  description: 'Polyergon — orchestrate your AI coding agents',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
