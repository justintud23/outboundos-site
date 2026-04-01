import { UserButton, OrganizationSwitcher } from '@clerk/nextjs'

interface HeaderProps {
  title: string
}

export function Header({ title }: HeaderProps) {
  return (
    <header className="h-14 border-b border-[#1e2130] flex items-center justify-between px-6">
      <h1 className="text-[#e2e8f0] font-semibold text-base">{title}</h1>
      <div className="flex items-center gap-3">
        <OrganizationSwitcher
          appearance={{
            elements: {
              rootBox: 'text-sm',
              organizationSwitcherTrigger:
                'text-[#94a3b8] hover:text-white py-1 px-2 rounded-md hover:bg-[#1a1d2e]',
            },
          }}
        />
        <UserButton />
      </div>
    </header>
  )
}
