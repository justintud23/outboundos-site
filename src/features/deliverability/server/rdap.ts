// Domain registration date via RDAP (the registries' public JSON API; rdap.org
// redirects to the right registry). Best-effort: any failure → null, and a null
// date keeps the domain on the young-domain cap until known.
export async function fetchRegistrationDate(domain: string, fetchImpl: typeof fetch = fetch): Promise<Date | null> {
  try {
    const res = await fetchImpl(`https://rdap.org/domain/${domain.toLowerCase()}`, {
      headers: { Accept: 'application/rdap+json' },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { events?: { eventAction?: string; eventDate?: string }[] }
    const raw = body.events?.find((e) => e.eventAction === 'registration')?.eventDate
    const date = raw ? new Date(raw) : null
    return date && !Number.isNaN(date.getTime()) ? date : null
  } catch {
    return null
  }
}
