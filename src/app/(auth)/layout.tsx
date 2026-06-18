import { Logo } from '@/components/brand/logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Left — Prism brand panel (indigo → violet gradient) */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between p-10 relative overflow-hidden bg-[linear-gradient(150deg,#4a43e0_0%,#5b54f0_45%,#7c6cf5_100%)]">
        {/* Spectrum aurora orbs */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-white/15 rounded-full blur-3xl" />
        <div className="absolute bottom-16 -right-16 w-64 h-64 bg-[#ff7a66]/25 rounded-full blur-3xl" />
        <div className="absolute top-1/3 -right-24 w-56 h-56 bg-[#0fb6a7]/20 rounded-full blur-3xl" />

        {/* Logo */}
        <div className="relative z-10">
          <Logo size="lg" variant="light" />
        </div>

        {/* Tagline */}
        <div className="relative z-10 space-y-4">
          <h2 className="font-display text-2xl font-semibold text-white leading-snug">
            Outbound that tells you<br />
            what to do next.
          </h2>
          <p className="text-white/75 text-sm leading-relaxed max-w-sm">
            AI-powered sales automation with a decision engine that prioritizes your pipeline and lets you execute without leaving the page.
          </p>
        </div>

        {/* Bottom accent */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex -space-x-1">
            <div className="w-2 h-2 rounded-full bg-white ring-2 ring-[#5b54f0]" />
            <div className="w-2 h-2 rounded-full bg-[#ffb3a6] ring-2 ring-[#5b54f0]" />
            <div className="w-2 h-2 rounded-full bg-[#7fe9dd] ring-2 ring-[#5b54f0]" />
          </div>
          <span className="text-white/70 text-xs">Decision engine for outbound sales</span>
        </div>
      </div>

      {/* Right — Form panel */}
      <div className="flex-1 flex flex-col items-center bg-[var(--bg-base)] px-6 py-10 sm:py-12 relative overflow-y-auto sm:justify-center">
        {/* Mobile logo */}
        <div className="lg:hidden mb-8 sm:mb-10 flex-shrink-0">
          <Logo size="md" />
        </div>

        <div className="w-full flex-shrink-0">
          {children}
        </div>
      </div>
    </div>
  )
}
