/**
 * The per-user settings every calculation depends on. DATABASE.md §6.1.
 */
export interface Profile {
  readonly id: string
  readonly displayName: string
  /** IANA zone. The single input that turns an instant into "today". */
  readonly timezone: string
  readonly currency: string
  readonly locale: string
  /** 1–28: the day the user's financial month begins. */
  readonly budgetPeriodStartDay: number
  readonly onboardingCompletedAt: string | null
  readonly onboardingVersion: number
  readonly gamificationEnabled: boolean
  readonly updatedAt: string
}

/** The onboarding version this build expects. Bumping it re-opens onboarding (PRODUCT.md §8). */
export const CURRENT_ONBOARDING_VERSION = 1

export function needsOnboarding(
  profile: Pick<Profile, 'onboardingCompletedAt' | 'onboardingVersion'>,
): boolean {
  return (
    profile.onboardingCompletedAt === null || profile.onboardingVersion < CURRENT_ONBOARDING_VERSION
  )
}

/** A short list for the settings picker. Any valid IANA zone is accepted by the database. */
export const COMMON_TIMEZONES = [
  'Asia/Kolkata',
  'Asia/Dubai',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Europe/London',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
  'UTC',
] as const
