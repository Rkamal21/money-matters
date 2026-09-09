/**
 * The composition root.
 *
 * Milestone 0 deliberately renders a foundation shell and nothing else: there
 * is no router, no query client and no auth provider yet, because there is no
 * feature to route to, no table to query and no user to authenticate. Those
 * providers arrive in M1 alongside the features that need them
 * (ROADMAP.md — Milestone 1); adding them now would be scaffolding with no
 * consumer.
 *
 * What this component *is* for is proving the harness end to end: it is what
 * the component test renders and what the E2E spec loads in a real browser.
 */
export function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="text-brand text-sm font-medium tracking-wide uppercase">
          Milestone 0 · Foundation
        </p>
        <h1 className="text-text text-3xl font-semibold">Money Matters</h1>
        <p className="text-text-muted text-base">Track smart. Save smarter.</p>
      </header>

      <section
        aria-labelledby="foundation-status"
        className="border-border bg-surface shadow-card rounded-lg border p-5"
      >
        <h2 id="foundation-status" className="text-text text-lg font-semibold">
          Foundation ready
        </h2>
        <p className="text-text-muted mt-2 text-sm">
          The toolchain, the layer boundaries, the validated configuration and the four test
          harnesses are in place. Authentication and onboarding land in Milestone 1.
        </p>
      </section>
    </main>
  )
}
