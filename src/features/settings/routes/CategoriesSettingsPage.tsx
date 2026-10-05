import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronLeft,
  ChevronUp,
  Plus,
  Trash,
} from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { z } from 'zod'

import { Button, IconButton } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import {
  CATEGORY_COLOR_CHOICES,
  CATEGORY_ICON_CHOICES,
  CATEGORY_SWATCH,
  CategoryIcon,
  Glyph,
} from '@/components/ui/CategoryIcon'
import { Field, Input } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { ErrorState, LoadingBlock, Skeleton } from '@/components/ui/States'
import { Badge } from '@/components/ui/Status'
import { useToast } from '@/components/ui/Toast'
import { useCategories, useInvalidateLedger } from '@/data/queries'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import type { Category, CategoryKind, CategoryTreatment } from '@/domain/transactions/types'
import { usePageTitle } from '@/hooks/usePageTitle'
import { cn } from '@/lib/cn'
import { toAppError } from '@/lib/errors'
import { queryKeys } from '@/lib/queryKeys'
import { useUserId } from '@/lib/session'

const TREATMENTS: readonly {
  readonly value: CategoryTreatment
  readonly label: string
  readonly body: string
}[] = [
  {
    value: 'variable',
    label: 'Day-to-day',
    body: 'Counts against your safe daily limit. Most categories.',
  },
  {
    value: 'fixed',
    label: 'Fixed',
    body: 'Committed money — rent, EMIs, subscriptions. Planned for, not spread daily.',
  },
  {
    value: 'excluded',
    label: 'Not counted',
    body: 'Never counts against a budget — e.g. reimbursable work spend.',
  },
]

export function CategoriesSettingsPage() {
  usePageTitle('Categories')
  const categories = useCategories()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [kind, setKind] = useState<CategoryKind>('expense')
  const [editing, setEditing] = useState<Category | 'new' | null>(null)

  const list = (categories.data ?? []).filter((category) => category.kind === kind)
  const active = list
    .filter((category) => !category.isArchived)
    .sort((a, b) => a.position - b.position)
  const archived = list.filter((category) => category.isArchived)

  const reorder = useMutation({
    mutationFn: (ids: string[]) => repositories.categories.reorder(ids),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.categories() }),
    onError: (error) => toast.show({ tone: 'error', title: toAppError(error).userMessage }),
  })

  const move = (index: number, offset: -1 | 1) => {
    const ids = active.map((category) => category.id)
    const target = index + offset
    const moving = ids[index]
    const other = ids[target]
    if (moving === undefined || other === undefined) return
    ids[index] = other
    ids[target] = moving
    reorder.mutate(ids)
  }

  return (
    <div className="flex flex-col gap-5">
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-sm font-medium text-text-muted hover:text-text"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        Settings
      </Link>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text">Categories</h1>
          <p className="text-sm text-text-muted">
            Rename freely — suggestions and history keep working.
          </p>
        </div>
        <Button
          icon={<Plus aria-hidden="true" className="size-4" />}
          onClick={() => setEditing('new')}
        >
          Add
        </Button>
      </header>

      <SegmentedControl
        legend="Kind"
        value={kind}
        options={[
          { value: 'expense', label: 'Spending' },
          { value: 'income', label: 'Income' },
        ]}
        onChange={setKind}
      />

      {categories.isPending ? (
        <LoadingBlock label="Loading categories">
          <Skeleton className="h-64 w-full" />
        </LoadingBlock>
      ) : categories.isError ? (
        <ErrorState
          error={toAppError(categories.error)}
          onRetry={() => void categories.refetch()}
        />
      ) : (
        <>
          <Card className="p-0 sm:p-0">
            <ul className="divide-y divide-border">
              {active.map((category, index) => (
                <li key={category.id} className="flex min-h-16 items-center gap-2 pr-2 pl-4">
                  <button
                    type="button"
                    onClick={() => setEditing(category)}
                    className="flex min-w-0 flex-1 items-center gap-3 py-2 text-left"
                  >
                    <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-text">
                        {category.name}
                      </span>
                      <span className="text-xs text-text-muted">
                        {
                          TREATMENTS.find((treatment) => treatment.value === category.treatment)
                            ?.label
                        }
                        {category.isSystem ? ' · built-in' : ''}
                      </span>
                    </span>
                  </button>
                  <IconButton
                    label={`Move ${category.name} up`}
                    disabled={index === 0 || reorder.isPending}
                    onClick={() => move(index, -1)}
                  >
                    <ChevronUp aria-hidden="true" className="size-4" />
                  </IconButton>
                  <IconButton
                    label={`Move ${category.name} down`}
                    disabled={index === active.length - 1 || reorder.isPending}
                    onClick={() => move(index, 1)}
                  >
                    <ChevronDown aria-hidden="true" className="size-4" />
                  </IconButton>
                </li>
              ))}
            </ul>
          </Card>
          {archived.length > 0 && (
            <details className="rounded-xl border border-border bg-surface">
              <summary className="flex min-h-12 cursor-pointer items-center px-4 text-sm font-medium text-text">
                Archived ({archived.length})
              </summary>
              <ul className="divide-y divide-border border-t border-border">
                {archived.map((category) => (
                  <li key={category.id}>
                    <button
                      type="button"
                      onClick={() => setEditing(category)}
                      className="flex min-h-14 w-full items-center gap-3 px-4 text-left hover:bg-surface-2/60"
                    >
                      <CategoryIcon icon={category.icon} color={category.color} size="sm" />
                      <span className="text-sm text-text-muted">{category.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {editing !== null && (
        <CategorySheet
          category={editing === 'new' ? null : editing}
          kind={kind}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

const schema = z.object({
  name: z.string().trim().min(1, 'Name the category.').max(40, 'Keep it under 40 characters.'),
  treatment: z.enum(['fixed', 'variable', 'excluded']),
  icon: z.string().min(1),
  color: z.string().min(1),
})

function CategorySheet({
  category,
  kind,
  onClose,
}: {
  readonly category: Category | null
  readonly kind: CategoryKind
  readonly onClose: () => void
}) {
  const userId = useUserId()
  const toast = useToast()
  const queryClient = useQueryClient()
  const invalidateLedger = useInvalidateLedger()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name ?? '',
      treatment: category?.treatment ?? 'variable',
      icon: category?.icon ?? 'tag',
      color: category?.color ?? 'blue',
    },
  })
  const { errors } = form.formState
  const icon = form.watch('icon')
  const color = form.watch('color')
  const effectiveKind = category?.kind ?? kind

  const done = async (title: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.categories() }),
      invalidateLedger(),
    ])
    toast.show({ tone: 'success', title })
    onClose()
  }

  const save = useMutation({
    mutationFn: (values: z.infer<typeof schema>) =>
      category === null
        ? repositories.categories.create(userId, { ...values, kind })
        : repositories.categories.update(category.id, values),
    onSuccess: () => done(category === null ? 'Category added' : 'Category saved'),
    onError: (error) => setServerError(toAppError(error)),
  })

  const archive = useMutation({
    mutationFn: () => {
      if (category === null) throw new Error('none')
      return repositories.categories.update(category.id, { isArchived: !category.isArchived })
    },
    onSuccess: () =>
      done(category?.isArchived ? 'Category restored' : 'Category archived — its history is kept'),
    onError: (error) => setServerError(toAppError(error)),
  })

  const remove = useMutation({
    mutationFn: () => {
      if (category === null) throw new Error('none')
      return repositories.categories.remove(category.id)
    },
    onSuccess: () => done('Category deleted'),
    onError: (error) => setServerError(toAppError(error)),
  })

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={category === null ? 'Add category' : 'Edit category'}
      size="lg"
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => save.mutate(values))(event)}
        className="flex flex-col gap-5"
      >
        {serverError && <ErrorState error={serverError} title="That did not work" compact />}
        <div className="flex items-end gap-3">
          <CategoryIcon icon={icon} color={color} size="lg" />
          <Field className="flex-1" label="Name" error={errors.name?.message}>
            {(control) => <Input {...control} {...form.register('name')} />}
          </Field>
        </div>

        {effectiveKind === 'expense' && (
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-text">How it counts</legend>
            <div className="flex flex-col gap-2">
              {TREATMENTS.map((treatment) => (
                <label
                  key={treatment.value}
                  className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-brand has-[:checked]:bg-brand/5"
                >
                  <input
                    type="radio"
                    value={treatment.value}
                    className="mt-1 size-4"
                    {...form.register('treatment')}
                  />
                  <span>
                    <span className="block text-sm font-medium text-text">{treatment.label}</span>
                    <span className="block text-xs text-text-muted">{treatment.body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Icon</legend>
          <div className="grid grid-cols-6 gap-2 sm:grid-cols-9">
            {CATEGORY_ICON_CHOICES.map((name) => {
              return (
                <label
                  key={name}
                  className={cn(
                    'flex size-11 cursor-pointer items-center justify-center rounded-lg border',
                    'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                    icon === name
                      ? 'border-brand bg-brand/10 text-brand'
                      : 'border-border text-text-muted hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    value={name}
                    className="sr-only"
                    aria-label={name.replace(/-/g, ' ')}
                    {...form.register('icon')}
                  />
                  <Glyph name={name} className="size-5" />
                </label>
              )
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-text">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_COLOR_CHOICES.map((name) => (
              <label
                key={name}
                className={cn(
                  'flex size-11 cursor-pointer items-center justify-center rounded-full border-2',
                  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  color === name ? 'border-text' : 'border-transparent',
                )}
              >
                <input
                  type="radio"
                  value={name}
                  className="sr-only"
                  aria-label={name}
                  {...form.register('color')}
                />
                <span
                  aria-hidden="true"
                  className={cn('size-7 rounded-full', CATEGORY_SWATCH[name])}
                />
              </label>
            ))}
          </div>
        </fieldset>

        <Button type="submit" size="lg" block loading={save.isPending}>
          {category === null ? 'Add category' : 'Save'}
        </Button>

        {category !== null && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <Button
              variant="secondary"
              loading={archive.isPending}
              icon={
                category.isArchived ? (
                  <ArchiveRestore aria-hidden="true" className="size-4" />
                ) : (
                  <Archive aria-hidden="true" className="size-4" />
                )
              }
              onClick={() => archive.mutate()}
            >
              {category.isArchived ? 'Restore' : 'Archive'}
            </Button>
            {category.isSystem ? (
              <Badge>Built-in: archive rather than delete</Badge>
            ) : (
              <Button
                variant="ghost"
                className="text-negative"
                loading={remove.isPending}
                icon={<Trash aria-hidden="true" className="size-4" />}
                onClick={() => remove.mutate()}
              >
                Delete
              </Button>
            )}
          </div>
        )}
      </form>
    </Sheet>
  )
}
