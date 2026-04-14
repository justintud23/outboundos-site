import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
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
      <html lang="en" className={inter.variable}>
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
