# `scripts/` — build-time generators and checks

Plain Node ESM, run by npm scripts and by CI. Nothing here ships to a browser.

| Script                            | Run by                                                       | Does                                                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `generate-category-constants.mjs` | `npm run gen:categories`, `npm run build`, the `lint` CI job | Generates `src/config/categories.generated.ts` from the authoritative block in `supabase/seed.sql`. `--check` fails on a diff (ARCHITECTURE.md §R.5, TESTING.md §4.4) |
| `check-bundle.mjs`                | the `build` and `security` CI jobs                           | Enforces the 200 KB gzipped budget (ARCHITECTURE.md §L) and scans `dist/` for a `service_role` key or any other credential (SECURITY.md §8.3)                         |
| `ensure-local-supabase.mjs`       | `npm run dev`, `npm run dev:phone` (the `predev` hooks)      | When `VITE_SUPABASE_URL` is local, starts Docker Desktop and `supabase start` if Auth does not answer, and waits for it. Never resets or reseeds                      |

All of them exit non-zero on failure and print what to do about it. None has a "warn only" mode: a check
that can be ignored is a check that is ignored.
