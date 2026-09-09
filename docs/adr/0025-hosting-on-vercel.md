# ADR-0025 — Hosting on Vercel

Status: **Accepted** · Date: 2026-09-09 · Records the Milestone 0 choice left open by
[ARCHITECTURE.md §C.5](../ARCHITECTURE.md)

## Context

[ARCHITECTURE.md §C.5](../ARCHITECTURE.md) lists hosting as "Vercel or Cloudflare Pages", marks it
"**still undecided, and it needs no ADR** — the choice is reversible in an afternoon because the
build output is a static bundle either way", and instructs: "Pick one in Milestone 0 and record it
in the README."

[ROADMAP.md](../ROADMAP.md) explains why it cannot wait: "Preview deploys per PR are a
Definition-of-Done dependency, so the choice cannot wait." [CONTRIBUTING.md §6](../CONTRIBUTING.md)
makes a preview deployment part of the Definition of Done.

So the decision is due in M0, and §C.5 names the README as its home. This ADR exists because the
choice was made without the team in the room, and a decision recorded only in a README paragraph is
easy to reverse by accident later — which is exactly what the ADR log is for. It is a **record**,
not a justification of a decision that needed one.

## Decision

**Vercel**, with a preview deployment per pull request.

- Build command `npm run build`, output directory `dist`, framework preset "Vite".
- The `VITE_*` variables from `.env.example`, configured per environment. None is a secret — see
  [`src/config/README.md`](../../src/config/README.md).
- Production deploys from `main`; every PR gets a preview URL.

Recorded in the README under **Hosting**, as §C.5 requires.

## Alternatives

1. **Cloudflare Pages** — the other candidate in §C.5. Equivalent for a static SPA: per-PR previews,
   a global CDN, and a comparable free tier.
2. **GitHub Pages** — free and already adjacent to the CI, but no per-PR preview deployments without
   building the mechanism ourselves.
3. **Defer to Milestone 10.** §C.5's own words rule this out: previews are a DoD dependency from the
   first reviewed PR.

## Reasoning

Between options 1 and 2 there is no architectural difference worth arguing about, which is precisely
why §C.5 said it needed no ADR. Vercel is chosen for the smaller thing that is actually different:
its Vite preset and PR preview comments need no configuration beyond the two settings above, and the
project has no Cloudflare-specific requirement (no Workers, no KV, no Durable Objects) that would
make Pages the better fit.

Option 3 fails the Definition of Done. "Reviewers should click, not clone" is the reason previews
exist, and it applies to the first PR as much as the fiftieth.

**The reversal path is real and short**: point Cloudflare Pages at the repository with the same build
command and output directory, move the environment variables, change the DNS. Nothing in `src/`,
`supabase/` or `.github/` refers to the host — the CI pipeline builds and tests, it does not deploy —
so the blast radius is this ADR, the README paragraph, and a dashboard.

## Tradeoffs

- **A vendor account becomes part of the release path.** Mitigated by the reversal path above and by
  CI that does not depend on the host.
- **The choice was made without team input.** It is recorded here so it can be reversed on purpose
  rather than discovered.
- **Neither host is exercised yet.** No deployment has run; this ADR records the decision, and the
  first PR preview is what will prove it.

## Consequences

- README **Hosting** section names Vercel and the settings.
- Deployment is not wired into `.github/workflows/ci.yml`; Vercel's own GitHub integration handles
  it, so CI stays a test pipeline.
- If this is the wrong choice, supersede this ADR rather than editing it.
