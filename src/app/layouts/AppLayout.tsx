import {
  ArrowLeftRight,
  ChartPie,
  Gauge,
  House,
  type LucideIcon,
  Moon,
  Plus,
  Settings,
  Sun,
  Target,
  Trophy,
  Wallet,
} from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'

import { Avatar } from '@/components/ui/Avatar'
import { IconButton } from '@/components/ui/Button'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { BrandMark } from '@/components/ui/Splash'
import { useProfile } from '@/data/queries'
import { cn } from '@/lib/cn'
import { useTheme } from '@/lib/theme'

/**
 * The signed-in shell. Mobile-first (ARCHITECTURE.md §F.5 rule 6): a bottom
 * tab bar in thumb reach below `lg`, with the add button in the middle of it
 * — logging an expense must take under ten seconds one-handed (PRODUCT.md
 * §4.3). A sidebar from `lg` up.
 *
 * The phone header follows the reference design's action bar: the person's
 * avatar on the left (it opens settings), actions on the right, on the grey
 * ground rather than a bordered bar.
 */

interface NavItem {
  readonly to: string
  readonly label: string
  readonly icon: LucideIcon
}

const PRIMARY: readonly NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: House },
  { to: '/transactions', label: 'Activity', icon: ArrowLeftRight },
  { to: '/budget', label: 'Budget', icon: Gauge },
  { to: '/goals', label: 'Goals', icon: Target },
]

const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings }

function useSecondaryNav(): readonly NavItem[] {
  const gamification = useProfile().data?.gamificationEnabled ?? false
  return [
    { to: '/wallets', label: 'Wallets', icon: Wallet },
    { to: '/insights', label: 'Insights', icon: ChartPie },
    ...(gamification ? [{ to: '/progress', label: 'Progress', icon: Trophy }] : []),
  ]
}

function ThemeToggle() {
  const { resolved, setPreference } = useTheme()
  const next = resolved === 'dark' ? 'light' : 'dark'
  return (
    <IconButton label={`Switch to ${next} theme`} onClick={() => setPreference(next)}>
      {resolved === 'dark' ? (
        <Sun aria-hidden="true" className="size-5" />
      ) : (
        <Moon aria-hidden="true" className="size-5" />
      )}
    </IconButton>
  )
}

export function AppLayout() {
  const location = useLocation()
  const secondary = useSecondaryNav()
  const name = useProfile().data?.displayName ?? ''

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[15rem_1fr]">
      <a
        href="#main"
        className="sr-only z-[70] rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Sidebar, lg and up */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-card-border bg-surface px-3 py-5 lg:flex">
        <Link
          to="/dashboard"
          className="mb-6 flex items-center gap-2 px-2 text-base font-semibold text-text"
        >
          <BrandMark />
          Money Matters
        </Link>
        <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
          {[...PRIMARY, ...secondary, SETTINGS].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors duration-150',
                  isActive
                    ? 'bg-brand-strong text-on-brand'
                    : 'text-text-muted hover:bg-surface-2 hover:text-text',
                )
              }
            >
              <item.icon aria-hidden="true" className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <Link
          to="/transactions/new"
          state={{ background: location }}
          className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-strong text-sm font-semibold text-on-brand shadow-card hover:bg-brand-strong/90"
        >
          <Plus aria-hidden="true" className="size-5" />
          Add transaction
        </Link>
        <div className="flex items-center gap-2.5 rounded-xl bg-bg px-2 py-2">
          <Avatar name={name} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text">
            {name || 'You'}
          </span>
          <ThemeToggle />
        </div>
      </aside>

      <div className="flex min-h-dvh min-w-0 flex-col">
        {/* Action bar, below lg */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 bg-bg/90 px-3 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden">
          <div className="flex min-w-0 items-center gap-2.5">
            <Link to="/settings" aria-label="Settings" className="rounded-full">
              <Avatar name={name} />
            </Link>
            <span className="truncate text-base font-semibold text-text max-[380px]:sr-only">
              Money Matters
            </span>
          </div>
          <div className="flex items-center">
            {secondary.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                aria-label={item.label}
                title={item.label}
                className={({ isActive }) =>
                  cn(
                    'inline-flex size-11 items-center justify-center rounded-xl transition-colors duration-150',
                    isActive
                      ? 'bg-surface text-text shadow-card'
                      : 'text-text-muted hover:text-text',
                  )
                }
              >
                <item.icon aria-hidden="true" className="size-5" />
              </NavLink>
            ))}
            <ThemeToggle />
          </div>
        </header>

        <main
          id="main"
          tabIndex={-1}
          className="mx-auto w-full max-w-5xl flex-1 px-4 pt-2 pb-28 sm:px-6 lg:pt-8 lg:pb-12"
        >
          <ErrorBoundary resetKey={location.pathname} title="This page could not be shown">
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* Bottom tab bar, below lg */}
        <nav
          aria-label="Main"
          className="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl border-t border-card-border bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-overlay backdrop-blur lg:hidden"
        >
          <ul className="mx-auto grid h-16 max-w-lg grid-cols-5 items-center px-2">
            {PRIMARY.slice(0, 2).map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
            <li className="flex justify-center">
              <Link
                to="/transactions/new"
                state={{ background: location }}
                aria-label="Add transaction"
                className="-mt-7 inline-flex size-14 items-center justify-center rounded-full bg-brand-strong text-on-brand shadow-overlay ring-4 ring-bg transition-transform duration-150 active:scale-95"
              >
                <Plus aria-hidden="true" className="size-7" />
              </Link>
            </li>
            {PRIMARY.slice(2).map((item) => (
              <TabLink key={item.to} item={item} />
            ))}
          </ul>
        </nav>
      </div>
    </div>
  )
}

function TabLink({ item }: { readonly item: NavItem }) {
  return (
    <li className="flex justify-center">
      <NavLink
        to={item.to}
        className={({ isActive }) =>
          cn(
            'flex h-14 w-full flex-col items-center justify-center gap-1 rounded-xl text-[0.6875rem] transition-colors duration-150',
            isActive ? 'font-semibold text-text' : 'font-medium text-text-muted hover:text-text',
          )
        }
      >
        {({ isActive }) => (
          <>
            <item.icon aria-hidden="true" className="size-6" strokeWidth={isActive ? 2.4 : 2} />
            {item.label}
          </>
        )}
      </NavLink>
    </li>
  )
}
