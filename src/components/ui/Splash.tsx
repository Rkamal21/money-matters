/**
 * The ₹ splash, from v1's design language (ARCHITECTURE.md V1 audit: "genuinely
 * good — carried forward as design reference"). Shown only while the auth
 * session resolves, so a signed-in user never sees the login screen flash.
 */
export function Splash({ label = 'Loading Money Matters' }: { readonly label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-bg"
    >
      <div
        aria-hidden="true"
        className="mm-splash-mark flex size-18 items-center justify-center rounded-full border-2 border-brand/35 bg-brand/10 text-4xl font-bold text-brand"
      >
        ₹
      </div>
      <p className="text-lg font-semibold tracking-tight text-text" aria-hidden="true">
        Money Matters
      </p>
      <span className="sr-only">{label}</span>
    </div>
  )
}

/** The mark alone, for headers. */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-8 items-center justify-center rounded-full bg-brand/10 text-lg font-bold text-brand ${className ?? ''}`}
    >
      ₹
    </span>
  )
}
