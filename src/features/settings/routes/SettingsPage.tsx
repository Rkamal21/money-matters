import {
  ChevronRight,
  LogOut,
  Palette,
  Shapes,
  ShieldCheck,
  Trophy,
  User,
  Wallet,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card, CardSection } from '@/components/ui/Card'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useProfile } from '@/data/queries'
import { repositories } from '@/data/repositories'
import { usePageTitle } from '@/hooks/usePageTitle'
import { useSession } from '@/lib/session'
import { type ThemePreference, useTheme } from '@/lib/theme'

const SECTIONS = [
  {
    to: '/settings/profile',
    label: 'Profile & preferences',
    body: 'Name, timezone, when your month starts',
    icon: User,
  },
  {
    to: '/settings/accounts',
    label: 'Accounts',
    body: 'Bank, cash, cards and wallets',
    icon: Wallet,
  },
  {
    to: '/settings/categories',
    label: 'Categories',
    body: 'Names, icons, fixed or variable',
    icon: Shapes,
  },
  {
    to: '/settings/security',
    label: 'Security & data',
    body: 'Password, sign-out, export, delete',
    icon: ShieldCheck,
  },
] as const

export function SettingsPage() {
  usePageTitle('Settings')
  const session = useSession()
  const profile = useProfile().data
  const navigate = useNavigate()
  const { preference, setPreference } = useTheme()

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">Settings</h1>
        {session.status === 'signed_in' && session.user.email && (
          <p className="text-sm text-text-muted">Signed in as {session.user.email}</p>
        )}
      </header>

      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {SECTIONS.map((section) => (
            <li key={section.to}>
              <Link
                to={section.to}
                className="flex min-h-16 items-center gap-3 px-4 hover:bg-surface-2/60"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 items-center justify-center rounded-full bg-brand/10 text-brand"
                >
                  <section.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-text">{section.label}</span>
                  <span className="block truncate text-xs text-text-muted">{section.body}</span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 text-text-muted" />
              </Link>
            </li>
          ))}
          {profile?.gamificationEnabled && (
            <li>
              <Link
                to="/progress"
                className="flex min-h-16 items-center gap-3 px-4 hover:bg-surface-2/60"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 items-center justify-center rounded-full bg-caution/12 text-caution"
                >
                  <Trophy className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-text">Progress</span>
                  <span className="block truncate text-xs text-text-muted">
                    Streak, level and achievements
                  </span>
                </span>
                <ChevronRight aria-hidden="true" className="size-5 text-text-muted" />
              </Link>
            </li>
          )}
        </ul>
      </Card>

      <CardSection
        title={
          <span className="inline-flex items-center gap-2">
            <Palette aria-hidden="true" className="size-4" /> Appearance
          </span>
        }
        titleId="settings-appearance"
      >
        <SegmentedControl<ThemePreference>
          legend="Theme"
          value={preference}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          onChange={setPreference}
        />
      </CardSection>

      <Button
        variant="secondary"
        icon={<LogOut aria-hidden="true" className="size-4" />}
        onClick={() => {
          void repositories.auth.signOut('local').then(() => navigate('/login', { replace: true }))
        }}
      >
        Sign out
      </Button>

      <p className="text-center text-xs text-text-muted">
        Money Matters 2.0 · Your data is private to you. We never sell or share it.
      </p>
    </div>
  )
}
