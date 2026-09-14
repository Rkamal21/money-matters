/**
 * Feature flags. The dashboard registry carries entries behind these, and a
 * flag that is off renders the registry around a gap-free hole
 * (PRODUCT.md §7, ROADMAP.md M7).
 *
 * `gamification` is also a per-user choice (`profiles.gamification_enabled`);
 * the flag decides whether the product ships the surface, the profile decides
 * whether this user sees it.
 */
export const FLAGS = {
  insights: true,
  gamification: true,
} as const

export type Flag = keyof typeof FLAGS
