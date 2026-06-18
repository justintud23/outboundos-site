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
  // Prism is a light theme — the wordmark reads in ink on every surface, so we
  // drive it from tokens. `variant === 'light'` (white text) is reserved for
  // the rare dark surface; default resolves to token ink.
  const textColor = variant === 'light' ? 'text-white' : 'text-[var(--text-primary)]'
  // On a dark/brand surface the indigo "OS" would vanish — use a light peach
  // accent from the Prism spectrum; on light surfaces keep the indigo signal.
  const osColor = variant === 'light' ? 'text-[#ffb3a6]' : 'text-[var(--accent-indigo)]'

  return (
    <div className={`flex items-center ${s.gap}`}>
      <div
        className="relative flex items-center justify-center rounded-xl"
        style={{ width: s.icon, height: s.icon }}
      >
        {/* Prism gradient mark (indigo → violet) */}
        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#5b54f0] via-[#6a5bf2] to-[#7c6cf5] shadow-[0_6px_16px_rgba(91,84,240,0.35)]" />
        {/* Soft glow ring */}
        <div className="absolute -inset-[1px] rounded-xl bg-gradient-to-br from-[#5b54f0]/30 to-[#7c6cf5]/25 blur-[1px]" />
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
        <span className={`${s.text} font-display font-semibold tracking-tight ${textColor}`}>
          Outbound<span className={osColor}>OS</span>
        </span>
      )}
    </div>
  )
}
