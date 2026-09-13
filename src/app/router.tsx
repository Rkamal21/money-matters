import { lazy, Suspense, type ComponentType, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, type Location } from 'react-router'

import { Skeleton } from '@/components/ui/States'
import { usePageTitle } from '@/hooks/usePageTitle'

import { PublicOnly, RequireAuth, RequireOnboarding } from './guards'
import { AppLayout } from './layouts/AppLayout'
import { AuthLayout } from './layouts/AuthLayout'

/**
 * The route table — ARCHITECTURE.md §F.3. Every page is its own lazy chunk,
 * so a user who never opens Insights never downloads it (§L).
 *
 * Adding and editing a transaction are modal routes over whatever page the
 * user was on (`state.background`), so the add button works from anywhere and
 * the Android back button closes the sheet rather than the app.
 */

function page<T extends Record<string, ComponentType>>(loader: () => Promise<T>, name: keyof T) {
  return lazy(async () => ({ default: (await loader())[name] as ComponentType }))
}

const LoginPage = page(() => import('@/features/auth/routes/AuthPages'), 'LoginPage')
const SignupPage = page(() => import('@/features/auth/routes/AuthPages'), 'SignupPage')
const CheckEmailPage = page(() => import('@/features/auth/routes/AuthPages'), 'CheckEmailPage')
const ResetPasswordPage = page(
  () => import('@/features/auth/routes/AuthPages'),
  'ResetPasswordPage',
)
const UpdatePasswordPage = page(
  () => import('@/features/auth/routes/AuthPages'),
  'UpdatePasswordPage',
)
const OnboardingPage = page(
  () => import('@/features/onboarding/routes/OnboardingPage'),
  'OnboardingPage',
)
const DashboardPage = page(
  () => import('@/features/dashboard/routes/DashboardPage'),
  'DashboardPage',
)
const TransactionsPage = page(
  () => import('@/features/transactions/routes/TransactionsPage'),
  'TransactionsPage',
)
const TransactionSheetRoute = page(
  () => import('@/features/transactions/routes/TransactionSheetRoute'),
  'TransactionSheetRoute',
)
const BudgetPage = page(() => import('@/features/budget/routes/BudgetPage'), 'BudgetPage')
const GoalsPage = page(() => import('@/features/goals/routes/GoalsPage'), 'GoalsPage')
const GoalDetailPage = page(
  () => import('@/features/goals/routes/GoalDetailPage'),
  'GoalDetailPage',
)
const WalletsPage = page(() => import('@/features/wallets/routes/WalletsPage'), 'WalletsPage')
const WalletDetailPage = page(
  () => import('@/features/wallets/routes/WalletDetailPage'),
  'WalletDetailPage',
)
const InsightsPage = page(() => import('@/features/insights/routes/InsightsPage'), 'InsightsPage')
const ProgressPage = page(
  () => import('@/features/gamification/routes/ProgressPage'),
  'ProgressPage',
)
const SettingsPage = page(() => import('@/features/settings/routes/SettingsPage'), 'SettingsPage')
const ProfileSettingsPage = page(
  () => import('@/features/settings/routes/ProfileSettingsPage'),
  'ProfileSettingsPage',
)
const AccountsSettingsPage = page(
  () => import('@/features/settings/routes/AccountsSettingsPage'),
  'AccountsSettingsPage',
)
const CategoriesSettingsPage = page(
  () => import('@/features/settings/routes/CategoriesSettingsPage'),
  'CategoriesSettingsPage',
)
const SecuritySettingsPage = page(
  () => import('@/features/settings/routes/SecuritySettingsPage'),
  'SecuritySettingsPage',
)

function PageFallback() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-4">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  )
}

function Lazy({ children }: { readonly children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>
}

export function NotFoundPage() {
  usePageTitle('Not found')
  return (
    <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-16">
      <h1 className="text-2xl font-semibold text-text">This page is not available</h1>
      <p className="text-text-muted">It may have been moved, deleted, or never existed.</p>
      <Link to="/dashboard" className="font-medium text-brand underline-offset-4 hover:underline">
        Back to your dashboard
      </Link>
    </div>
  )
}

interface BackgroundState {
  readonly background?: Location
}

export function AppRoutes() {
  const location = useLocation()
  const background = (location.state as BackgroundState | null)?.background

  return (
    <>
      <Routes location={background ?? location}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />

        <Route element={<PublicOnly />}>
          <Route element={<AuthLayout />}>
            <Route
              path="/login"
              element={
                <Lazy>
                  <LoginPage />
                </Lazy>
              }
            />
            <Route
              path="/signup"
              element={
                <Lazy>
                  <SignupPage />
                </Lazy>
              }
            />
            <Route
              path="/check-email"
              element={
                <Lazy>
                  <CheckEmailPage />
                </Lazy>
              }
            />
            <Route
              path="/reset-password"
              element={
                <Lazy>
                  <ResetPasswordPage />
                </Lazy>
              }
            />
          </Route>
        </Route>

        <Route element={<AuthLayout />}>
          <Route
            path="/update-password"
            element={
              <Lazy>
                <UpdatePasswordPage />
              </Lazy>
            }
          />
        </Route>

        <Route element={<RequireAuth />}>
          <Route
            path="/onboarding"
            element={
              <Lazy>
                <OnboardingPage />
              </Lazy>
            }
          />

          <Route element={<RequireOnboarding />}>
            <Route element={<AppLayout />}>
              <Route
                path="/dashboard"
                element={
                  <Lazy>
                    <DashboardPage />
                  </Lazy>
                }
              />
              <Route
                path="/transactions"
                element={
                  <Lazy>
                    <TransactionsPage />
                  </Lazy>
                }
              />
              <Route
                path="/transactions/new"
                element={
                  <Lazy>
                    <TransactionsPage />
                  </Lazy>
                }
              />
              <Route
                path="/transactions/:id/edit"
                element={
                  <Lazy>
                    <TransactionsPage />
                  </Lazy>
                }
              />
              <Route
                path="/budget"
                element={
                  <Lazy>
                    <BudgetPage />
                  </Lazy>
                }
              />
              <Route
                path="/goals"
                element={
                  <Lazy>
                    <GoalsPage />
                  </Lazy>
                }
              />
              <Route
                path="/goals/:id"
                element={
                  <Lazy>
                    <GoalDetailPage />
                  </Lazy>
                }
              />
              <Route
                path="/wallets"
                element={
                  <Lazy>
                    <WalletsPage />
                  </Lazy>
                }
              />
              <Route
                path="/wallets/:id"
                element={
                  <Lazy>
                    <WalletDetailPage />
                  </Lazy>
                }
              />
              <Route
                path="/insights"
                element={
                  <Lazy>
                    <InsightsPage />
                  </Lazy>
                }
              />
              <Route
                path="/progress"
                element={
                  <Lazy>
                    <ProgressPage />
                  </Lazy>
                }
              />
              <Route
                path="/settings"
                element={
                  <Lazy>
                    <SettingsPage />
                  </Lazy>
                }
              />
              <Route
                path="/settings/profile"
                element={
                  <Lazy>
                    <ProfileSettingsPage />
                  </Lazy>
                }
              />
              <Route
                path="/settings/accounts"
                element={
                  <Lazy>
                    <AccountsSettingsPage />
                  </Lazy>
                }
              />
              <Route
                path="/settings/categories"
                element={
                  <Lazy>
                    <CategoriesSettingsPage />
                  </Lazy>
                }
              />
              <Route
                path="/settings/security"
                element={
                  <Lazy>
                    <SecuritySettingsPage />
                  </Lazy>
                }
              />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>

      {/* The same URL, rendered as a sheet on top of whatever page it was opened from. */}
      {/* The catch-all sits OUTSIDE the auth guard: inside it, every public
          page would match `*`, be sent to /login, match `*` again — a loop. */}
      <Routes>
        <Route element={<RequireAuth />}>
          <Route
            path="/transactions/new"
            element={
              <Lazy>
                <TransactionSheetRoute />
              </Lazy>
            }
          />
          <Route
            path="/transactions/:id/edit"
            element={
              <Lazy>
                <TransactionSheetRoute />
              </Lazy>
            }
          />
        </Route>
        <Route path="*" element={null} />
      </Routes>
    </>
  )
}
