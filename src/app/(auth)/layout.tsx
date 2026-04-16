import { Logo } from '@/components/brand/logo'

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex">
      {/* Left — Branding panel */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[540px] flex-col justify-between bg-slate-950 p-10 relative overflow-hidden">
        {/* Subtle gradient orbs */}
        <div className="absolute -top-24 -left-24 w-72 h-72 bg-indigo-600/15 rounded-full blur-3xl" />
        <div className="absolute bottom-20 -right-20 w-64 h-64 bg-violet-600/10 rounded-full blur-3xl" />

        {/* Logo */}
        <div className="relative z-10">
          <Logo size="lg" variant="dark" />
        </div>

        {/* Tagline */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-2xl font-semibold text-white leading-snug">
            Outbound that tells you<br />
            what to do next.
          </h2>
          <p className="text-slate-400 text-sm leading-relaxed max-w-sm">
            AI-powered sales automation with a decision engine that prioritizes your pipeline and lets you execute without leaving the page.
          </p>
        </div>

        {/* Bottom accent */}
        <div className="relative z-10 flex items-center gap-3">
          <div className="flex -space-x-1">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <div className="w-2 h-2 rounded-full bg-violet-500" />
            <div className="w-2 h-2 rounded-full bg-cyan-500" />
          </div>
          <span className="text-slate-500 text-xs">Decision engine for outbound sales</span>
        </div>
      </div>

      {/* Right — Form panel */}
      <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 px-6 py-12 relative">
        {/* Mobile logo */}
        <div className="lg:hidden mb-10">
          <Logo size="md" variant="light" />
        </div>

        {children}
      </div>
    </div>
  )
}
