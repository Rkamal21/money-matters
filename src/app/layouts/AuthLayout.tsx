import { Outlet } from 'react-router'

import { BrandMark } from '@/components/ui/Splash'

/**
 * The public shell, after the reference design's welcome screen: a dark
 * panel with the identity-colour tile collage and the promise, and the form
 * beside it (desktop) or on a sheet below it (phone).
 *
 * The collage replaces the reference's photograph with the ₹ mark — the
 * project ships no image assets. It is decorative and hidden from assistive
 * technology; each page's own `h1` ("Welcome back", …) names the page.
 */
export function AuthLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg lg:grid lg:grid-cols-2">
      <div className="theme-inverse relative flex flex-col gap-8 overflow-hidden px-6 pt-8 pb-16 lg:justify-between lg:px-12 lg:py-12">
        <div className="flex items-center gap-2">
          <BrandMark className="size-9 text-lg" />
          <span className="text-base font-semibold">Money Matters</span>
        </div>

        <div className="flex flex-col gap-6">
          <TileCollage />
          <div>
            <p className="max-w-sm text-3xl leading-tight font-semibold tracking-tight lg:text-4xl">
              Make your financial management easier
            </p>
            <p className="mt-3 max-w-sm text-sm text-text-muted">
              Know what is safe to spend today, see where every rupee went, and give your savings a
              purpose.
            </p>
          </div>
        </div>

        <p className="hidden text-xs text-text-muted lg:block">
          Your data is private to you. We never sell or share it.
        </p>
      </div>

      <main
        id="main"
        className="relative -mt-8 flex flex-1 flex-col rounded-t-3xl bg-bg px-5 pt-8 pb-8 lg:mt-0 lg:justify-center lg:rounded-none lg:px-12"
      >
        <div className="mx-auto w-full max-w-md">
          <Outlet />
        </div>
        <p className="mt-10 text-center text-xs text-text-muted lg:hidden">
          Your data is private to you. We never sell or share it.
        </p>
      </main>
    </div>
  )
}

/** The reference's geometric tiles in the identity hues, around the ₹ mark. */
function TileCollage() {
  const tile = 'size-14 sm:size-16 lg:size-20'
  return (
    <div aria-hidden="true" className="grid w-fit grid-cols-3 gap-2">
      <span className={`${tile} rounded-tl-full bg-id-coral`} />
      <span className={`${tile} rounded-t-full bg-id-teal`} />
      <span className={`${tile} rounded-tr-full bg-id-yellow`} />
      <span className={`${tile} rounded-l-full bg-id-blue`} />
      <span
        className={`${tile} flex items-center justify-center rounded-2xl bg-white text-3xl font-bold text-inverse lg:text-4xl`}
      >
        ₹
      </span>
      <span className={`${tile} rounded-r-full bg-id-pink`} />
      <span className={`${tile} rounded-bl-full bg-id-yellow`} />
      <span className={`${tile} rounded-b-full bg-id-coral`} />
      <span className={`${tile} rounded-br-full bg-id-teal`} />
    </div>
  )
}
