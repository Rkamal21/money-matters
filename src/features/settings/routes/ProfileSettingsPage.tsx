import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { CardSection } from '@/components/ui/Card'
import { Field, Input, Select } from '@/components/ui/Field'
import { Switch } from '@/components/ui/SegmentedControl'
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { useProfile } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import { COMMON_TIMEZONES, type Profile } from '@/domain/profile/Profile'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

const schema = z.object({
  displayName: z.string().trim().max(80, 'Keep it under 80 characters.'),
  timezone: z.string().min(1),
  budgetPeriodStartDay: z.coerce.number().int().min(1).max(28),
  gamificationEnabled: z.boolean(),
})

export function ProfileSettingsPage() {
  usePageTitle('Profile & preferences')
  const profile = useProfile()

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Settings
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-text">Profile & preferences</h1>
      {profile.isPending ? (
        <LoadingBlock label="Loading your profile">
          <Skeleton className="h-72 w-full" />
        </LoadingBlock>
      ) : profile.isError ? (
        <ErrorState error={toAppError(profile.error)} onRetry={() => void profile.refetch()} />
      ) : (
        <ProfileForm profile={profile.data} />
      )}
    </div>
  )
}

function ProfileForm({ profile }: { readonly profile: Profile }) {
  const userId = useUserId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.input<typeof schema>, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      displayName: profile.displayName,
      timezone: profile.timezone,
      budgetPeriodStartDay: profile.budgetPeriodStartDay,
      gamificationEnabled: profile.gamificationEnabled,
    },
  })
  const { errors, isDirty } = form.formState
  const zones = [...new Set([profile.timezone, ...COMMON_TIMEZONES])]

  const save = useMutation({
    mutationFn: (values: z.output<typeof schema>) => repositories.profiles.update(userId, values),
    onSuccess: async (updated) => {
      setServerError(null)
      queryClient.setQueryData(queryKeys.profile(), updated)
      // Period boundaries depend on the zone and the start day; everything derived re-reads.
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== 'profile' })
      form.reset({
        displayName: updated.displayName,
        timezone: updated.timezone,
        budgetPeriodStartDay: updated.budgetPeriodStartDay,
        gamificationEnabled: updated.gamificationEnabled,
      })
      toast.show({ tone: 'success', title: 'Preferences saved' })
    },
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <CardSection title="Your details" titleId="profile-details">
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-4"
      >
        {serverError && <ErrorState error={serverError} title="Not saved" compact />}
        <Field label="Name" optional error={errors.displayName?.message}>
          {(control) => (
            <Input {...control} autoComplete="given-name" {...form.register('displayName')} />
          )}
        </Field>
        <Field
          label="Timezone"
          hint="Decides when your day ends. Changing it moves period boundaries; it never changes the date on a transaction you already logged."
          error={errors.timezone?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('timezone')}>
              {zones.map((zone) => (
                <option key={zone} value={zone}>
                  {zone.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Your month starts on day"
          hint="Paid on the 25th? Choose 25. The current period keeps its dates; the next one starts on the new day."
          error={errors.budgetPeriodStartDay?.message}
        >
          {(control) => (
            <Select {...control} {...form.register('budgetPeriodStartDay')}>
              {Array.from({ length: 28 }, (_, index) => index + 1).map((day) => (
                <option key={day} value={day}>
                  {day}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          label="Currency"
          hint="Money Matters records one currency per person. More are planned."
        >
          {(control) => (
            <Select {...control} value="INR" disabled onChange={() => undefined}>
              <option value="INR">Indian rupee (₹)</option>
            </Select>
          )}
        </Field>
        <Switch
          checked={form.watch('gamificationEnabled')}
          onChange={(checked) =>
            form.setValue('gamificationEnabled', checked, { shouldDirty: true })
          }
          label="Streaks, levels and achievements"
          description="Optional. When off, nothing is shown and nothing is awarded."
        />
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending} disabled={!isDirty}>
            Save
          </Button>
        </div>
      </form>
    </CardSection>
  )
}
