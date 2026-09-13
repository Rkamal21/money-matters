import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarCheck, Flame, Lock } from 'lucide-react'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CardSection } from '@/components/ui/Card'
import { Glyph } from '@/components/ui/CategoryIcon'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { ProgressBar } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { useGamificationProfile, usePreferences, useProfile, useToday } from '@/data/queries'
import { repositories } from '@/data/repositories'
import { progressToNextLevel, XP_RULES, xpEventLabel } from '@/domain/gamification/gamification'
import { relativeDayLabel } from '@/domain/period/labels'
import { equals } from '@/domain/period/LocalDate'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

/**
 * Gamification — ROADMAP.md M9, deliberately restrained (PRODUCT.md §9).
 * Opt-out, visually secondary, and every point explained: the XP history is
 * the ledger itself (`gamification_events`), not a counter.
 */
export function ProgressPage() {
  usePageTitle('Progress')
  const userId = useUserId()
  const today = useToday()
  const { locale } = usePreferences()
  const profile = useProfile()
  const game = useGamificationProfile()
  const toast = useToast()
  const queryClient = useQueryClient()
  const enabled = profile.data?.gamificationEnabled ?? false

  const achievements = useQuery({
    queryKey: queryKeys.achievements(),
    enabled,
    queryFn: () => repositories.gamification.listAchievements(userId),
  })
  const events = useQuery({
    queryKey: queryKeys.xpEvents(),
    enabled,
    queryFn: () => repositories.gamification.listEvents(userId, 50),
  })

  const checkIn = useMutation({
    mutationFn: () => {
      if (today === null) throw new Error('today unknown')
      return repositories.gamification.checkIn(today)
    },
    onSuccess: async () => {
      toast.show({ tone: 'success', title: 'Checked in for today' })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.gamification() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.dashboard() }),
      ])
    },
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  if (!profile.isPending && !enabled) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Progress</h1>
        <Card>
          <EmptyState
            title="Progress is turned off"
            body="Streaks, levels and achievements are optional. Nothing is awarded while they are off."
            action={
              <Link to="/settings/profile" className="font-medium text-brand hover:underline">
                Turn them on in settings
              </Link>
            }
          />
        </Card>
      </div>
    )
  }

  if (game.isPending || today === null) {
    return (
      <LoadingBlock label="Loading your progress">
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-40 w-full" />
        </div>
      </LoadingBlock>
    )
  }
  if (game.isError)
    return <ErrorState error={toAppError(game.error)} onRetry={() => void game.refetch()} />

  const data = game.data
  const level = progressToNextLevel(data?.xpTotal ?? 0)
  const checkedIn = data?.lastCheckInOn != null && equals(data.lastCheckInOn, today)

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Progress</h1>
        <p className="text-sm text-text-muted">
          Habits, not keystrokes: outcomes earn more than activity.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <p className="text-sm text-text-muted">Level</p>
          <p className="text-4xl font-semibold text-text tabular">{level.level}</p>
          <ProgressBar
            ratio={level.ratio}
            label={`${level.current} of ${level.needed} XP to level ${level.level + 1}`}
          />
          <p className="text-xs text-text-muted tabular">
            {data?.xpTotal ?? 0} XP total · {level.needed - level.current} to the next level
          </p>
        </Card>
        <Card className="flex flex-col gap-3">
          <p className="flex items-center gap-2 text-sm text-text-muted">
            <Flame aria-hidden="true" className="size-4 text-caution" /> Check-in streak
          </p>
          <p className="text-4xl font-semibold text-text tabular">
            {data?.currentStreak ?? 0}
            <span className="ml-1 text-base font-normal text-text-muted">
              {(data?.currentStreak ?? 0) === 1 ? 'day' : 'days'}
            </span>
          </p>
          <p className="text-xs text-text-muted">Longest: {data?.longestStreak ?? 0} days</p>
          <Button
            variant={checkedIn ? 'secondary' : 'primary'}
            disabled={checkedIn}
            loading={checkIn.isPending}
            icon={<CalendarCheck aria-hidden="true" className="size-4" />}
            onClick={() => checkIn.mutate()}
          >
            {checkedIn ? 'Checked in today' : 'Check in for today'}
          </Button>
        </Card>
      </div>

      <CardSection title="Achievements" titleId="progress-achievements">
        {achievements.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : achievements.isError ? (
          <ErrorState
            error={toAppError(achievements.error)}
            onRetry={() => void achievements.refetch()}
            compact
          />
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(achievements.data ?? []).map((achievement) => {
              const unlocked = achievement.unlockedAt !== null
              return (
                <li
                  key={achievement.code}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3',
                    unlocked ? 'border-positive/30 bg-positive/5' : 'border-border',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'inline-flex size-10 shrink-0 items-center justify-center rounded-full',
                      unlocked ? 'bg-positive/15 text-positive' : 'bg-surface-2 text-text-muted',
                    )}
                  >
                    {unlocked ? (
                      <Glyph name={achievement.icon} className="size-5" />
                    ) : (
                      <Lock className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-text">
                      {achievement.name}
                      <span className="sr-only">{unlocked ? ', unlocked' : ', locked'}</span>
                    </p>
                    <p className="text-xs text-text-muted">{achievement.description}</p>
                    <p className="mt-0.5 text-xs text-text-muted tabular">
                      {achievement.xpReward} XP
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardSection>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <CardSection title="XP history" titleId="progress-history">
          {events.isPending ? (
            <Skeleton className="h-32 w-full" />
          ) : (events.data ?? []).length === 0 ? (
            <EmptyState title="No XP yet" body="Log a transaction or check in to start." />
          ) : (
            <ul className="divide-y divide-border text-sm">
              {(events.data ?? []).map((event) => (
                <li key={event.id} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    <span className="block text-text">{xpEventLabel(event.type)}</span>
                    <span className="text-xs text-text-muted">
                      {relativeDayLabel(event.occurredOn, today, locale)}
                    </span>
                  </span>
                  <span className="font-semibold text-positive tabular">+{event.xpAwarded}</span>
                </li>
              ))}
            </ul>
          )}
        </CardSection>

        <CardSection title="How XP works" titleId="progress-rules">
          <table className="w-full text-sm">
            <caption className="sr-only">XP for each kind of event, and its limit</caption>
            <tbody className="divide-y divide-border">
              {XP_RULES.map((rule) => (
                <tr key={rule.type}>
                  <th scope="row" className="py-2 text-left font-normal text-text">
                    {rule.label}
                  </th>
                  <td className="py-2 text-right font-medium tabular">
                    {rule.xp === 'varies' ? 'varies' : `${rule.xp} XP`}
                  </td>
                  <td className="py-2 pl-3 text-right text-xs text-text-muted">{rule.cap}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-text-muted">
            XP is awarded by the server and cannot be edited — not even by you. You can turn all of
            this off in settings.
          </p>
        </CardSection>
      </div>
    </div>
  )
}
