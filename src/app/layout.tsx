import type { Metadata, Viewport } from 'next'
import './globals.css'

// Installable as an app (Chrome: ⋮ → Cast, save and share → Install page as app)
export const metadata: Metadata = {
  title: 'Polyergon',
  description: 'Run every Claude Code session from one screen',
  manifest: '/manifest.webmanifest',
  icons: { icon: [{ url: '/icon.svg', type: 'image/svg+xml' }, { url: '/icon-192.png', sizes: '192x192' }], apple: '/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Polyergon', statusBarStyle: 'black-translucent' },
}

export const viewport: Viewport = { themeColor: '#030712' }

const THEME_SCRIPT = `try{var t=localStorage.getItem('theme')||'dark';if(t==='system')t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';document.documentElement.dataset.theme=t}catch(e){}`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      {/* Before paint, so light mode doesn't flash dark. Choice lives in this browser (Settings → Appearance). */}
      <head><script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} /></head>
      <body className="bg-gray-950 text-white antialiased">{children}</body>
    </html>
  )
}
