import type { Metadata, Viewport } from 'next'
import { Geist_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import './globals.css'

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
})

export const metadata: Metadata = {
  title: 'TC ADDRESS TRACER // chain analysis terminal',
  description:
    'Trace whether your Bitcoin addresses can be linked back to a centralized exchange. Retro terminal chain-analysis tool.',
  generator: 'v0.app',
}

export const viewport: Viewport = {
  themeColor: '#0a120d',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`dark ${geistMono.variable} bg-background`}>
      <body className="font-mono antialiased crt-scanlines crt-vignette">
        {children}
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
