'use client'

import { createContext, useContext, useState, useEffect, useCallback, useSyncExternalStore } from 'react'

interface SidebarContextValue {
  expanded: boolean
  toggle: () => void
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

const STORAGE_KEY = 'outboundos-sidebar'

// The sidebar's expanded/collapsed state is persisted in localStorage. We model
// it as an external store read via useSyncExternalStore so that the server and
// the first client render agree ("expanded"), and the persisted value is applied
// after hydration — without synchronously calling setState inside an effect.
const sidebarListeners = new Set<() => void>()

function subscribeSidebar(callback: () => void): () => void {
  sidebarListeners.add(callback)
  return () => {
    sidebarListeners.delete(callback)
  }
}

function getSidebarSnapshot(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== 'collapsed'
}

function getSidebarServerSnapshot(): boolean {
  return true
}

function setSidebarExpanded(expanded: boolean): void {
  localStorage.setItem(STORAGE_KEY, expanded ? 'expanded' : 'collapsed')
  sidebarListeners.forEach((listener) => listener())
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const expanded = useSyncExternalStore(subscribeSidebar, getSidebarSnapshot, getSidebarServerSnapshot)
  const [mobileOpen, setMobileOpen] = useState(false)

  const toggle = useCallback(() => {
    setSidebarExpanded(!getSidebarSnapshot())
  }, [])

  // Close mobile drawer on resize past the desktop breakpoint
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
