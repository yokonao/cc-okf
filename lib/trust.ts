export type TrustTier = 'unverified' | 'machine-confirmed' | 'human-reviewed'

export const TRUST_TIERS: readonly TrustTier[] = ['unverified', 'machine-confirmed', 'human-reviewed']

export type Verification = { by: string; at?: string }

/** OKF §5.2: a bare mapping counts as a one-element list. */
export function verifications(value: unknown): Verification[] {
  const list: unknown[] = Array.isArray(value) ? value : value != null && typeof value === 'object' ? [value] : []
  return list.flatMap(item => {
    if (item == null || typeof item !== 'object') return []
    const { by, at } = item as Record<string, unknown>
    if (typeof by !== 'string' || by === '') return []
    return [{ by, at: typeof at === 'string' ? at : undefined }]
  })
}

/** OKF §5.3. */
export function trustTier(verified: readonly Verification[]): TrustTier {
  if (verified.length === 0) return 'unverified'
  return verified.some(v => v.by.startsWith('human:')) ? 'human-reviewed' : 'machine-confirmed'
}

export function trustRank(tier: TrustTier): number {
  return TRUST_TIERS.indexOf(tier)
}

/** OKF §5.5: stale once `now >= stale_after`. */
export function isStale(staleAfter: string | undefined, now: number): boolean {
  if (staleAfter === undefined) return false
  const t = Date.parse(staleAfter)
  return Number.isFinite(t) && now >= t
}
