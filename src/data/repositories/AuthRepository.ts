import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

import { AppErrorException, unexpectedError } from '@/lib/errors'

import type { Db } from '../supabase/client'
import { fail, mapAuthError } from '../supabase/mapErrors'

/**
 * AuthService's data half — API.md §2.1. A thin wrapper over Supabase Auth,
 * so no feature imports `supabase.auth` and error mapping happens once.
 */

export interface AuthSession {
  readonly userId: string
  readonly email: string | null
}

export type AuthEvent =
  | 'INITIAL_SESSION'
  | 'SIGNED_IN'
  | 'SIGNED_OUT'
  | 'TOKEN_REFRESHED'
  | 'USER_UPDATED'
  | 'PASSWORD_RECOVERY'

export interface AuthRepository {
  getSession(): Promise<AuthSession | null>
  onChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void
  signUp(input: {
    readonly email: string
    readonly password: string
    readonly displayName: string
    readonly timezone: string
    readonly redirectTo: string
  }): Promise<{ readonly needsEmailConfirmation: boolean }>
  signIn(input: { readonly email: string; readonly password: string }): Promise<AuthSession>
  signOut(scope: 'local' | 'global'): Promise<void>
  requestPasswordReset(email: string, redirectTo: string): Promise<void>
  resendConfirmation(email: string, redirectTo: string): Promise<void>
  updatePassword(password: string): Promise<void>
  deleteAccount(): Promise<void>
}

function toSession(session: Session | null): AuthSession | null {
  return session === null ? null : { userId: session.user.id, email: session.user.email ?? null }
}

const KNOWN_EVENTS: ReadonlySet<string> = new Set<AuthEvent>([
  'INITIAL_SESSION',
  'SIGNED_IN',
  'SIGNED_OUT',
  'TOKEN_REFRESHED',
  'USER_UPDATED',
  'PASSWORD_RECOVERY',
])

function isKnownEvent(event: AuthChangeEvent): event is AuthEvent {
  return KNOWN_EVENTS.has(event)
}

export class SupabaseAuthRepository implements AuthRepository {
  private readonly db: Db

  constructor(db: Db) {
    this.db = db
  }

  async getSession(): Promise<AuthSession | null> {
    const { data, error } = await this.db.auth.getSession()
    if (error) throw new AppErrorException(mapAuthError(error))
    return toSession(data.session)
  }

  onChange(listener: (event: AuthEvent, session: AuthSession | null) => void): () => void {
    const { data } = this.db.auth.onAuthStateChange((event, session) => {
      if (isKnownEvent(event)) listener(event, toSession(session))
    })
    return () => data.subscription.unsubscribe()
  }

  async signUp(input: {
    readonly email: string
    readonly password: string
    readonly displayName: string
    readonly timezone: string
    readonly redirectTo: string
  }): Promise<{ readonly needsEmailConfirmation: boolean }> {
    const { data, error } = await this.db.auth.signUp({
      email: input.email,
      password: input.password,
      options: {
        emailRedirectTo: input.redirectTo,
        data: { display_name: input.displayName, timezone: input.timezone },
      },
    })
    if (error) {
      // An address that is already registered answers exactly like a new one,
      // so sign-up is not an account-enumeration oracle (SECURITY.md T15).
      if (error.code === 'user_already_exists') return { needsEmailConfirmation: true }
      throw new AppErrorException(mapAuthError(error))
    }
    return { needsEmailConfirmation: data.session === null }
  }

  async signIn(input: { readonly email: string; readonly password: string }): Promise<AuthSession> {
    const { data, error } = await this.db.auth.signInWithPassword(input)
    if (error) throw new AppErrorException(mapAuthError(error))
    const session = toSession(data.session)
    if (session === null) throw new AppErrorException(unexpectedError('no session after sign-in'))
    return session
  }

  async signOut(scope: 'local' | 'global'): Promise<void> {
    const { error } = await this.db.auth.signOut({ scope })
    // A session that is already gone is signed out; that is the goal.
    if (error && error.code !== 'session_not_found' && error.status !== 403) {
      throw new AppErrorException(mapAuthError(error))
    }
  }

  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.db.auth.resetPasswordForEmail(email, { redirectTo })
    if (!error) return
    const mapped = mapAuthError(error)
    // The caller always sees success, whether or not the address exists —
    // except when we genuinely could not send anything (API.md §2.1).
    if (mapped.kind === 'rate_limited' || mapped.kind === 'network')
      throw new AppErrorException(mapped)
  }

  async resendConfirmation(email: string, redirectTo: string): Promise<void> {
    const { error } = await this.db.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: redirectTo },
    })
    if (!error) return
    const mapped = mapAuthError(error)
    if (mapped.kind === 'rate_limited' || mapped.kind === 'network')
      throw new AppErrorException(mapped)
  }

  async updatePassword(password: string): Promise<void> {
    const { error } = await this.db.auth.updateUser({ password })
    if (error) throw new AppErrorException(mapAuthError(error))
  }

  async deleteAccount(): Promise<void> {
    const { error } = await this.db.rpc('delete_my_account')
    if (error) fail(error, { operation: 'rpc', entity: 'account' })
    // The auth user is gone; clearing the local session is all that is left.
    await this.db.auth.signOut({ scope: 'local' }).catch(() => undefined)
  }
}
