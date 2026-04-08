'use client'

import { createContext, useContext, useState, useEffect, useCallback } from 'react'

interface SidebarContextValue {
  expanded: boolean
  toggle: () => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const STORAGE_KEY = 'outboundos-sidebar'

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [expanded, setExpanded] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Read persisted state after mount
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'collapsed') {
      setExpanded(false)
    }
    setHydrated(true)
  }, [])

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev
      localStorage.setItem(STORAGE_KEY, next ? 'expanded' : 'collapsed')
      return next
    })
  }, [])

  // Close mobile drawer on route changes (resize past breakpoint)
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setMobileOpen(false)
      }
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Prevent body scroll when mobile drawer is open
  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  // Avoid layout flash — render nothing on server, render correct state after hydration
  if (!hydrated) {
    return (
      <SidebarContext.Provider value={{ expanded: true, toggle, mobileOpen: false, setMobileOpen }}>
        {children}
      </SidebarContext.Provider>
    )
  }

  return (
    <SidebarContext.Provider value={{ expanded, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  )
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext)
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider')
  }
  return ctx
}
