import type { AppError } from '@/domain/errors/AppError'
import { AppErrorException, createAppError, unexpectedError } from '@/lib/errors'

/**
 * Raw error → AppError. API.md §5.1: the ONE place raw errors are touched.
 *
 * The rule that matters: a database message never reaches a rendered string.
 * Postgres messages leak schema, constraint names and sometimes row contents;
 * `userMessage` is ours, per code, in words a person understands. The raw
 * error survives only as `cause`, which is logged and never rendered.
 *
 * Constraint names are part of the contract. Each maps to a stable code and a
 * message, and a test asserts every constraint in the schema has an entry here.
 */

interface Mapping {
  readonly code: string
  readonly message: string
  readonly field?: string
}

/** Named constraints — CHECK, UNIQUE, FOREIGN KEY, EXCLUDE — and trigger-raised ones. */
export const CONSTRAINT_MAP: Readonly<Record<string, Mapping>> = {
  // transactions
  tx_amount_positive_check: {
    code: 'transaction.amount_positive',
    message: 'Amount must be greater than zero.',
    field: 'amount',
  },
  tx_transfer_shape: {
    code: 'transaction.transfer_shape',
    message: 'A transfer needs two different accounts and no category.',
    field: 'counterAccountId',
  },
  tx_category_present: {
    code: 'transaction.category_required',
    message: 'Choose a category.',
    field: 'categoryId',
  },
  tx_split_has_no_direct_category: {
    code: 'transaction.split_category',
    message: 'A split transaction takes its categories from its parts.',
  },
  tx_refund_shape: {
    code: 'transaction.refund_shape',
    message: 'Only a refund can point at another transaction.',
  },
  tx_occurred_lower_bound: {
    code: 'transaction.date_too_early',
    message: 'Dates before the year 2000 are not supported.',
    field: 'occurredOn',
  },
  tx_occurred_upper_bound: {
    code: 'transaction.date_too_late',
    message: 'That date is too far in the future.',
    field: 'occurredOn',
  },
  tx_category_kind_match: {
    code: 'transaction.category_kind',
    message: 'That category does not fit this kind of transaction.',
    field: 'categoryId',
  },
  tx_currency_matches_account: {
    code: 'transaction.currency_mismatch',
    message: 'The amount must be in the account’s currency.',
    field: 'accountId',
  },
  tx_refund_of_expense: {
    code: 'transaction.refund_target',
    message: 'A refund can only point at an expense.',
  },
  tx_description_length_check: {
    code: 'transaction.description_length',
    message: 'Keep the description under 280 characters.',
    field: 'description',
  },
  tx_notes_length_check: {
    code: 'transaction.notes_length',
    message: 'Notes are too long.',
    field: 'notes',
  },
  tx_merchant_label_length_check: {
    code: 'transaction.merchant_length',
    message: 'The merchant name is too long.',
    field: 'merchantLabel',
  },
  tx_client_request_uk: {
    code: 'transaction.duplicate_request',
    message: 'This transaction was already saved.',
  },
  tx_account_fk: {
    code: 'transaction.unknown_account',
    message: 'Choose one of your accounts.',
    field: 'accountId',
  },
  tx_counter_account_fk: {
    code: 'transaction.unknown_account',
    message: 'Choose one of your accounts.',
    field: 'counterAccountId',
  },
  tx_category_fk: {
    code: 'transaction.unknown_category',
    message: 'Choose one of your categories.',
    field: 'categoryId',
  },
  tx_refund_of_fk: {
    code: 'transaction.unknown_refund_target',
    message: 'That transaction no longer exists.',
  },
  // splits
  splits_amount_positive_check: {
    code: 'split.amount_positive',
    message: 'Each part must be greater than zero.',
    field: 'splits',
  },
  transaction_splits_tx_category_uk: {
    code: 'split.duplicate_category',
    message: 'Use each category once in a split.',
    field: 'splits',
  },
  tx_split_total_matches: {
    code: 'split.total_mismatch',
    message: 'The parts must add up exactly to the total.',
    field: 'splits',
  },
  tx_split_min_parts: {
    code: 'split.min_parts',
    message: 'A split needs at least two parts.',
    field: 'splits',
  },
  tx_split_parts_present: {
    code: 'split.parts_required',
    message: 'A split transaction needs its parts.',
  },
  tx_transfer_not_split: { code: 'split.transfer', message: 'A transfer cannot be split.' },
  splits_transaction_fk: {
    code: 'split.unknown_transaction',
    message: 'That transaction no longer exists.',
  },
  splits_category_fk: {
    code: 'split.unknown_category',
    message: 'Choose one of your categories.',
    field: 'splits',
  },
  splits_note_length_check: {
    code: 'split.note_length',
    message: 'A part’s note is too long.',
    field: 'splits',
  },
  // accounts
  accounts_name_check: {
    code: 'account.name_invalid',
    message: 'Give the account a name of up to 60 characters.',
    field: 'name',
  },
  accounts_user_name_uk: {
    code: 'account.duplicate_name',
    message: 'You already have an account with that name.',
    field: 'name',
  },
  accounts_credit_limit_card_only_check: {
    code: 'account.credit_limit_card_only',
    message: 'Only a credit card has a credit limit.',
    field: 'creditLimit',
  },
  accounts_credit_limit_range_check: {
    code: 'account.credit_limit_range',
    message: 'Enter a credit limit of zero or more.',
    field: 'creditLimit',
  },
  accounts_last4_check: {
    code: 'account.last4',
    message: 'Enter exactly four digits.',
    field: 'last4',
  },
  accounts_opening_balance_range_check: {
    code: 'account.opening_balance_range',
    message: 'That opening balance is out of range.',
    field: 'openingBalance',
  },
  accounts_institution_length_check: {
    code: 'account.institution_length',
    message: 'The institution name is too long.',
    field: 'institution',
  },
  // categories
  categories_name_check: {
    code: 'category.name_invalid',
    message: 'Give the category a name of up to 40 characters.',
    field: 'name',
  },
  categories_system_not_deletable: {
    code: 'category.system',
    message: 'Built-in categories can be archived but not deleted.',
  },
  categories_user_slug_uk: {
    code: 'category.duplicate',
    message: 'You already have a category like that.',
  },
  categories_icon_format_check: {
    code: 'category.icon',
    message: 'Choose an icon.',
    field: 'icon',
  },
  categories_color_format_check: {
    code: 'category.color',
    message: 'Choose a colour.',
    field: 'color',
  },
  // budgets
  budget_periods_no_overlap: {
    code: 'budget.period_overlap',
    message: 'That period overlaps another one.',
  },
  budget_periods_amounts_check: {
    code: 'budget.amounts_invalid',
    message: 'Budget amounts must be zero or more.',
  },
  budget_periods_shape_check: {
    code: 'budget.period_shape',
    message: 'That is not a valid period.',
  },
  bcl_limit_range_check: {
    code: 'budget.limit_invalid',
    message: 'A limit must be zero or more.',
    field: 'limit',
  },
  bcl_period_category_uk: {
    code: 'budget.limit_exists',
    message: 'That category already has a limit.',
  },
  bcl_category_fk: { code: 'budget.unknown_category', message: 'Choose one of your categories.' },
  bcl_period_fk: { code: 'budget.unknown_period', message: 'That budget period no longer exists.' },
  // goals
  goals_name_check: {
    code: 'goal.name_invalid',
    message: 'Give the goal a name of up to 60 characters.',
    field: 'name',
  },
  goals_target_positive_check: {
    code: 'goal.target_positive',
    message: 'The target must be greater than zero.',
    field: 'target',
  },
  goals_wallet_uk: {
    code: 'goal.wallet_in_use',
    message:
      'That wallet already backs another goal. Choose a different wallet or create a new one.',
    field: 'walletAccountId',
  },
  goals_wallet_fk: {
    code: 'goal.wallet_invalid',
    message: 'A goal must be backed by one of your wallets.',
    field: 'walletAccountId',
  },
  goals_wallet_type_check: {
    code: 'goal.wallet_invalid',
    message: 'A goal must be backed by a wallet.',
  },
  // profiles
  profiles_start_day_range_check: {
    code: 'profile.start_day',
    message: 'Choose a day from 1 to 28.',
    field: 'budgetPeriodStartDay',
  },
  profiles_timezone_valid_check: {
    code: 'profile.timezone',
    message: 'Choose a valid timezone.',
    field: 'timezone',
  },
  profiles_display_name_length_check: {
    code: 'profile.display_name',
    message: 'Keep your name under 80 characters.',
    field: 'displayName',
  },
  profiles_currency_code_check: {
    code: 'profile.currency',
    message: 'Choose a currency.',
    field: 'currency',
  },
  profiles_locale_check: { code: 'profile.locale', message: 'Choose a language and region.' },
  // merchant rules
  mr_pattern_check: {
    code: 'merchant_rule.pattern',
    message: 'A rule needs at least two characters.',
  },
  mr_label_check: { code: 'merchant_rule.label', message: 'Give the rule a merchant name.' },
  mr_category_slug_check: { code: 'merchant_rule.category', message: 'Choose a category.' },
  mr_confidence_check: {
    code: 'merchant_rule.confidence',
    message: 'Confidence must be between 0 and 1.',
  },
}

/**
 * Trigger- and function-raised messages carry no constraint name through
 * PostgREST, so they are matched on the exact text we raised — ours, stable,
 * and never rendered.
 */
const RAISED_MESSAGE_MAP: Readonly<Record<string, string>> = {
  'occurred_on is too far in the future': 'tx_occurred_upper_bound',
  'the category kind does not match the transaction kind': 'tx_category_kind_match',
  'the currency does not match the account': 'tx_currency_matches_account',
  'the currency does not match the destination account': 'tx_currency_matches_account',
  'a refund must point at an expense': 'tx_refund_of_expense',
  'a transfer cannot be split': 'tx_transfer_not_split',
  'a split transaction needs its parts': 'tx_split_parts_present',
  'a split needs at least two parts': 'tx_split_min_parts',
  'split parts must sum to the transaction amount': 'tx_split_total_matches',
  'system categories cannot be deleted; archive it instead': 'categories_system_not_deletable',
}

/** When a delete trips a foreign key, the problem is "in use", whichever key it was. */
const IN_USE_ON_DELETE: Readonly<Record<string, Mapping>> = {
  accounts: {
    code: 'account.in_use',
    message:
      'This account has transactions or backs a goal. Archive it instead — its history is kept.',
  },
  categories: {
    code: 'category.in_use',
    message: 'This category is used by transactions or budgets. Archive it instead.',
  },
}

export interface ErrorContext {
  readonly operation?: 'read' | 'insert' | 'update' | 'delete' | 'rpc'
  /** The table being written, for "in use" messages on delete. */
  readonly table?: string
  /** The entity, for `<entity>.not_found`. */
  readonly entity?: string
}

interface RawError {
  readonly code?: unknown
  readonly message?: unknown
  readonly details?: unknown
  readonly hint?: unknown
  readonly status?: unknown
  readonly name?: unknown
}

function asRaw(error: unknown): RawError {
  return typeof error === 'object' && error !== null ? error : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const CONSTRAINT_NAME = /constraint "([^"]+)"/

function constraintOf(raw: RawError): string | null {
  const fromMessage = CONSTRAINT_NAME.exec(text(raw.message))?.[1]
  if (fromMessage !== undefined) return fromMessage
  const fromDetails = CONSTRAINT_NAME.exec(text(raw.details))?.[1]
  if (fromDetails !== undefined) return fromDetails
  return RAISED_MESSAGE_MAP[text(raw.message)] ?? null
}

function fromMapping(kind: AppError['kind'], mapping: Mapping, cause: unknown): AppError {
  return createAppError({
    kind,
    code: mapping.code,
    userMessage: mapping.message,
    ...(mapping.field === undefined ? {} : { fieldErrors: { [mapping.field]: [mapping.message] } }),
    cause,
  })
}

function isNetworkFailure(error: unknown): boolean {
  const raw = asRaw(error)
  const message = text(raw.message)
  return (
    (error instanceof TypeError && /fetch|network|load failed/i.test(message)) ||
    /Failed to fetch|NetworkError|Load failed|ERR_INTERNET_DISCONNECTED/i.test(message) ||
    text(raw.name) === 'AuthRetryableFetchError'
  )
}

/** GoTrue error codes → AppError. */
const AUTH_CODES: Readonly<Record<string, Mapping & { readonly kind: AppError['kind'] }>> = {
  invalid_credentials: {
    kind: 'authentication',
    code: 'auth.invalid_credentials',
    message: 'Email or password is incorrect.',
  },
  email_not_confirmed: {
    kind: 'authentication',
    code: 'auth.email_not_confirmed',
    message: 'Confirm your email address first — the link is in your inbox.',
  },
  weak_password: {
    kind: 'validation',
    code: 'auth.weak_password',
    message: 'Choose a longer password: at least 10 characters.',
    field: 'password',
  },
  same_password: {
    kind: 'validation',
    code: 'auth.same_password',
    message: 'Choose a password you have not used here before.',
    field: 'password',
  },
  over_request_rate_limit: {
    kind: 'rate_limited',
    code: 'auth.rate_limited',
    message: 'Too many attempts. Wait a minute and try again.',
  },
  over_email_send_rate_limit: {
    kind: 'rate_limited',
    code: 'auth.rate_limited',
    message: 'Too many emails sent. Wait a minute and try again.',
  },
  session_not_found: {
    kind: 'authentication',
    code: 'auth.session_expired',
    message: 'Your session has ended. Sign in again.',
  },
  refresh_token_not_found: {
    kind: 'authentication',
    code: 'auth.session_expired',
    message: 'Your session has ended. Sign in again.',
  },
  otp_expired: {
    kind: 'authentication',
    code: 'auth.link_expired',
    message: 'That link has expired. Request a new one.',
  },
  validation_failed: {
    kind: 'validation',
    code: 'auth.invalid_input',
    message: 'Check the email address and try again.',
  },
  email_address_invalid: {
    kind: 'validation',
    code: 'auth.invalid_email',
    message: 'Enter a valid email address.',
    field: 'email',
  },
  signup_disabled: {
    kind: 'authorization',
    code: 'auth.signup_disabled',
    message: 'New sign-ups are closed right now.',
  },
}

export function mapAuthError(error: unknown): AppError {
  if (isNetworkFailure(error)) {
    return createAppError({
      kind: 'network',
      code: 'net.offline',
      userMessage: 'You appear to be offline. Check your connection and try again.',
      cause: error,
    })
  }
  const raw = asRaw(error)
  const mapping = AUTH_CODES[text(raw.code)]
  if (mapping !== undefined) return fromMapping(mapping.kind, mapping, error)
  if (raw.status === 429) {
    return createAppError({
      kind: 'rate_limited',
      code: 'auth.rate_limited',
      userMessage: 'Too many attempts. Wait a minute and try again.',
      cause: error,
    })
  }
  return unexpectedError(error)
}

/** PostgREST / Postgres error → AppError. */
export function mapDataError(error: unknown, context: ErrorContext = {}): AppError {
  if (isNetworkFailure(error)) {
    return createAppError({
      kind: 'network',
      code: 'net.offline',
      userMessage:
        'You appear to be offline. Your change was not saved — try again when you are back online.',
      cause: error,
    })
  }

  const raw = asRaw(error)
  const code = text(raw.code)
  const constraint = constraintOf(raw)
  const entity = context.entity ?? 'record'

  switch (code) {
    case '23505': {
      const mapping = constraint === null ? undefined : CONSTRAINT_MAP[constraint]
      return fromMapping(
        'conflict',
        mapping ?? { code: `${entity}.duplicate`, message: 'That already exists.' },
        error,
      )
    }
    case '23503': {
      if (context.operation === 'delete' && context.table !== undefined) {
        const inUse = IN_USE_ON_DELETE[context.table]
        if (inUse !== undefined) return fromMapping('conflict', inUse, error)
      }
      const mapping = constraint === null ? undefined : CONSTRAINT_MAP[constraint]
      return fromMapping(
        'validation',
        mapping ?? {
          code: `${entity}.invalid_reference`,
          message: 'That refers to something that no longer exists.',
        },
        error,
      )
    }
    case '23514':
    case '23502':
    case '22001':
    case '22003':
    case '22P02':
    case '22007':
    case '22023': {
      const mapping = constraint === null ? undefined : CONSTRAINT_MAP[constraint]
      return fromMapping(
        'validation',
        mapping ?? { code: `${entity}.invalid`, message: 'Some of those details are not valid.' },
        error,
      )
    }
    case '23P01': {
      const mapping = constraint === null ? undefined : CONSTRAINT_MAP[constraint]
      return fromMapping(
        'conflict',
        mapping ?? { code: `${entity}.overlap`, message: 'That overlaps something else.' },
        error,
      )
    }
    case '42501':
      return createAppError({
        kind: 'authorization',
        code: `${entity}.not_permitted`,
        userMessage: 'That change is not allowed.',
        cause: error,
      })
    case 'PGRST116':
    case 'P0002':
      return createAppError({
        kind: 'not_found',
        code: `${entity}.not_found`,
        userMessage: 'That could not be found. It may have been deleted.',
        cause: error,
      })
    case 'PGRST301':
    case 'PGRST303':
    case '28000':
      return createAppError({
        kind: 'authentication',
        code: 'auth.session_expired',
        userMessage: 'Your session has ended. Sign in again.',
        cause: error,
      })
    case '40001':
    case '40P01':
    case '55P03':
      return createAppError({
        kind: 'conflict',
        code: `${entity}.busy`,
        userMessage: 'That was being changed at the same moment. Try again.',
        cause: error,
        retryable: true,
      })
    default:
      if (raw.status === 401) {
        return createAppError({
          kind: 'authentication',
          code: 'auth.session_expired',
          userMessage: 'Your session has ended. Sign in again.',
          cause: error,
        })
      }
      if (raw.status === 429) {
        return createAppError({
          kind: 'rate_limited',
          code: 'net.rate_limited',
          userMessage: 'Too many requests. Wait a moment and try again.',
          cause: error,
        })
      }
      return createAppError({
        kind: 'data_access',
        code: `${entity}.data_access`,
        userMessage: 'We could not reach your data just now. Please try again.',
        cause: error,
        retryable: true,
      })
  }
}

/** Throw the mapped error. `never` so a repository can `return fail(...)` in any branch. */
export function fail(error: unknown, context?: ErrorContext): never {
  throw new AppErrorException(mapDataError(error, context))
}

/** For an update guarded by `updated_at`: zero rows means someone else changed it first. */
export function concurrentEditError(entity: string): AppErrorException {
  return new AppErrorException(
    createAppError({
      kind: 'conflict',
      code: `${entity}.concurrent_edit`,
      userMessage: 'This changed somewhere else. Reload to see the latest.',
    }),
  )
}
