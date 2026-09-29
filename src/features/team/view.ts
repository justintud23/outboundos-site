export type ViewMode = 'mine' | 'team'

/** ?view=mine|team; default 'mine' for members, 'team' for admins. Junk values fall back to the default. */
export function resolveView(isAdmin: boolean, param: string | string[] | undefined): ViewMode {
  const value = Array.isArray(param) ? param[0] : param
  if (value === 'mine' || value === 'team') return value
  return isAdmin ? 'team' : 'mine'
}

/** The ownerId to filter list queries by: the member's own id in 'mine' view, undefined (no filter) in 'team' view. */
export function ownerFilterFor(view: ViewMode, memberId: string): string | undefined {
  return view === 'mine' ? memberId : undefined
}
