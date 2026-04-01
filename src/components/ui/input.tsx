import { clsx } from 'clsx'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={clsx(
        'w-full bg-[#1a1d2e] border border-[#2a2d3e] text-[#e2e8f0] rounded-md px-3 py-2 text-sm',
        'placeholder:text-[#475569]',
        'focus:outline-none focus:border-[#6366f1] focus:ring-1 focus:ring-[#6366f1]',
        className,
      )}
      {...props}
    />
  )
}
