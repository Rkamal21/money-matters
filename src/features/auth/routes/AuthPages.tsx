import { zodResolver } from '@hookform/resolvers/zod'
import { MailCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { z } from 'zod'

import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { repositories } from '@/data/repositories'
import type { AppError } from '@/domain/errors/AppError'
import { usePageTitle } from '@/hooks/usePageTitle'
import { toAppError } from '@/lib/errors'
import { emailField, newPasswordField } from '@/lib/forms'
import { useSession } from '@/lib/session'

/**
 * Authentication — ROADMAP.md M1, SECURITY.md §3.
 *
 *   - Sign-in failure is one generic message, never "no such user".
 *   - Sign-up and password reset answer the same whether or not the address
 *     exists, so neither is an account-enumeration oracle.
 *   - Email confirmation is required before first sign-in.
 */

function origin(): string {
  return window.location.origin
}

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata'
  } catch {
    return 'Asia/Kolkata'
  }
}

function FormError({ error }: { readonly error: AppError | null }) {
  if (error === null) return null
  return <ErrorState error={error} title="That did not work" compact />
}

// ---------------------------------------------------------------------------

const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, 'Enter your password.'),
})

export function LoginPage() {
  usePageTitle('Sign in')
  const [params] = useSearchParams()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      await repositories.auth.signIn(values)
      // AuthProvider sees the session; PublicOnly sends the user on (to returnTo).
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Welcome back</h1>
        <p className="mt-1 text-sm text-text-muted">Sign in to see where your money is going.</p>
      </div>
      {params.get('reset') === '1' && (
        <p role="status" className="rounded-lg bg-positive/10 p-3 text-sm text-positive">
          Your password was updated. Sign in with the new one.
        </p>
      )}
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        <FormError error={serverError} />
        <Field label="Email" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              inputMode="email"
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Sign in
        </Button>
      </form>
      <div className="flex flex-col gap-2 text-sm">
        <Link to="/reset-password" className="font-medium text-brand hover:underline">
          Forgot your password?
        </Link>
        <p className="text-text-muted">
          New here?{' '}
          <Link to="/signup" className="font-medium text-brand hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const signupSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Tell us what to call you.')
    .max(80, 'Keep it under 80 characters.'),
  email: emailField,
  password: newPasswordField,
})

export function SignupPage() {
  usePageTitle('Create your account')
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof signupSchema>>({
    resolver: zodResolver(signupSchema),
    defaultValues: { displayName: '', email: '', password: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null)
    try {
      const result = await repositories.auth.signUp({
        ...values,
        timezone: detectTimezone(),
        redirectTo: `${origin()}/dashboard`,
      })
      if (result.needsEmailConfirmation) {
        await navigate(`/check-email?email=${encodeURIComponent(values.email)}`)
      }
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Create your account</h1>
        <p className="mt-1 text-sm text-text-muted">Free, private, and yours. Takes a minute.</p>
      </div>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        <FormError error={serverError} />
        <Field label="Your name" error={errors.displayName?.message}>
          {(control) => (
            <Input {...control} autoComplete="given-name" {...form.register('displayName')} />
          )}
        </Field>
        <Field label="Email" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              inputMode="email"
              {...form.register('email')}
            />
          )}
        </Field>
        <Field label="Password" hint="At least 10 characters." error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Create account
        </Button>
      </form>
      <p className="text-sm text-text-muted">
        Already have an account?{' '}
        <Link to="/login" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------

export function CheckEmailPage() {
  usePageTitle('Check your email')
  const [params] = useSearchParams()
  const email = params.get('email') ?? ''
  const toast = useToast()
  const [sending, setSending] = useState(false)

  const resend = async () => {
    if (email === '') return
    setSending(true)
    try {
      await repositories.auth.resendConfirmation(email, `${origin()}/dashboard`)
      toast.show({
        tone: 'success',
        title: 'Sent again',
        body: 'Give it a minute, and check your spam folder.',
      })
    } catch (error) {
      toast.show({ tone: 'error', title: toAppError(error).userMessage })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-col items-start gap-4">
      <span
        aria-hidden="true"
        className="inline-flex size-12 items-center justify-center rounded-full bg-brand/10 text-brand"
      >
        <MailCheck className="size-6" />
      </span>
      <h1 className="text-2xl font-semibold text-text">Check your email</h1>
      <p className="text-text-muted">
        {email ? (
          <>
            If <span className="font-medium text-text">{email}</span> is new to us, a confirmation
            link is on its way.
          </>
        ) : (
          'A confirmation link is on its way.'
        )}{' '}
        Open it on this device to finish creating your account.
      </p>
      <div className="flex flex-wrap gap-2">
        {email && (
          <Button variant="secondary" loading={sending} onClick={() => void resend()}>
            Send the link again
          </Button>
        )}
        <Link
          to="/login"
          className="inline-flex h-11 items-center px-3 text-sm font-medium text-brand hover:underline"
        >
          Back to sign in
        </Link>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------

const resetSchema = z.object({ email: emailField })

export function ResetPasswordPage() {
  usePageTitle('Reset your password')
  const [sent, setSent] = useState(false)
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { email: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ email }) => {
    setServerError(null)
    try {
      await repositories.auth.requestPasswordReset(email, `${origin()}/update-password`)
      setSent(true)
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  if (sent) {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold text-text">Check your email</h1>
        <p className="text-text-muted">
          If that address has an account, a link to choose a new password is on its way. It works
          once and expires within the hour.
        </p>
        <Link to="/login" className="text-sm font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Reset your password</h1>
        <p className="mt-1 text-sm text-text-muted">
          We will email you a link to choose a new one.
        </p>
      </div>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        <FormError error={serverError} />
        <Field label="Email" error={errors.email?.message}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="email"
              inputMode="email"
              {...form.register('email')}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Send reset link
        </Button>
      </form>
      <Link to="/login" className="text-sm font-medium text-brand hover:underline">
        Back to sign in
      </Link>
    </div>
  )
}

// ---------------------------------------------------------------------------

const updateSchema = z
  .object({ password: newPasswordField, confirm: z.string() })
  .refine((values) => values.password === values.confirm, {
    path: ['confirm'],
    message: 'The passwords do not match.',
  })

export function UpdatePasswordPage() {
  usePageTitle('Choose a new password')
  const session = useSession()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState<AppError | null>(null)
  const form = useForm<z.infer<typeof updateSchema>>({
    resolver: zodResolver(updateSchema),
    defaultValues: { password: '', confirm: '' },
  })
  const { errors, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async ({ password }) => {
    setServerError(null)
    try {
      await repositories.auth.updatePassword(password)
      await repositories.auth.signOut('global')
      await navigate('/login?reset=1', { replace: true })
    } catch (error) {
      setServerError(toAppError(error))
    }
  })

  if (session.status === 'loading') {
    return <p role="status">Checking your link…</p>
  }

  if (session.status === 'signed_out') {
    return (
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-2xl font-semibold text-text">That link has expired</h1>
        <p className="text-text-muted">
          Password links work once and only for a short while. Request a fresh one.
        </p>
        <Link to="/reset-password" className="text-sm font-medium text-brand hover:underline">
          Send a new link
        </Link>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-text">Choose a new password</h1>
        <p className="mt-1 text-sm text-text-muted">
          You will be signed out everywhere and asked to sign in again.
        </p>
      </div>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="flex flex-col gap-4">
        <FormError error={serverError} />
        <Field label="New password" hint="At least 10 characters." error={errors.password?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
          )}
        </Field>
        <Field label="Confirm new password" error={errors.confirm?.message}>
          {(control) => (
            <Input
              {...control}
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          )}
        </Field>
        <Button type="submit" size="lg" block loading={isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  )
}
