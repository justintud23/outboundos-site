interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  variant?: 'light' | 'dark'
  showText?: boolean
}

const SIZES = {
  sm: { icon: 28, text: 'text-base', gap: 'gap-2' },
  md: { icon: 36, text: 'text-xl', gap: 'gap-2.5' },
  lg: { icon: 44, text: 'text-2xl', gap: 'gap-3' },
}

export function Logo({ size = 'md', variant = 'dark', showText = true }: LogoProps) {
  const s = SIZES[size]
  const textColor = variant === 'light' ? 'text-slate-900' : 'text-white'

  return (
    <div className={`flex items-center ${s.gap}`}>
      <div
        className="relative flex items-center justify-center rounded-xl"
        style={{ width: s.icon, height: s.icon }}
      >
        {/* Gradient background */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 shadow-lg shadow-indigo-500/25" />
        {/* Glow ring */}
        <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-br from-indigo-400/20 to-violet-400/20 blur-[1px]" />
        {/* Icon mark */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="relative z-10"
          style={{ width: s.icon * 0.5, height: s.icon * 0.5 }}
        >
          {/* Abstract "send" arrows representing outbound */}
          <path
            d="M4 12L10 6L10 10L16 10L16 14L10 14L10 18Z"
            fill="white"
            fillOpacity="0.9"
          />
          <path
            d="M12 8L18 4L18 8L22 8L22 12L18 12L18 16Z"
            fill="white"
            fillOpacity="0.5"
          />
        </svg>
      </div>
      {showText && (
        <span className={`${s.text} font-semibold tracking-tight ${textColor}`}>
          Outbound<span className="text-indigo-500">OS</span>
        </span>
      )}
    </div>
  )
}
