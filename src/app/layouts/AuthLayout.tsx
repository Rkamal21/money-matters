import { Outlet } from 'react-router'

import { BrandMark } from '@/components/ui/Splash'

/** The public shell: one narrow column, the mark, and the form. */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <main
        id="main"
        className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-5 py-10"
      >
        <div className="mb-8 flex items-center gap-2">
          <BrandMark className="size-10 text-xl" />
          <div>
            <p className="text-lg font-semibold text-text">Money Matters</p>
            <p className="text-sm text-text-muted">Track smart. Save smarter.</p>
          </div>
        </div>
        <Outlet />
      </main>
      <p className="px-5 pb-6 text-center text-xs text-text-muted">
        Your data is private to you. We never sell or share it.
      </p>
    </div>
  )
}
