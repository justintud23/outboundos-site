import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})

// Monospace numerals for data (stat values, table figures, counts, dates).
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
})

export const metadata: Metadata = {
  title: 'OutboundOS',
  description: 'AI-assisted sales outreach platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
        <body className={inter.className}>
          <a href="#main-content" className="skip-to-content">
            Skip to content
          </a>
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
