# `src/` — application source

The folder structure is [ARCHITECTURE.md §F.1](../docs/ARCHITECTURE.md). The conceptual layering it
implements is [§A.2](../docs/ARCHITECTURE.md):

| §A.2 layer     | Lives in                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| Presentation   | `features/*/components`, `features/*/routes`, `components/`, `app/layouts` |
| Application    | `features/*/hooks`, `features/*/services`                                  |
| Domain         | `domain/` — pure, a leaf, imports nothing from the app                     |
| Data access    | `data/repositories`, `data/mappers`                                        |
| Infrastructure | `data/supabase`, `platform/`, `lib/observability`, `config/`               |

**Dependencies point downward only.** This is enforced by `eslint-plugin-boundaries` in
`eslint.config.js`, not by convention — see [§F.4](../docs/ARCHITECTURE.md).

Each directory below has its own `README.md` stating what it owns. A directory that exists with only
a README is a Milestone 0 placeholder: the milestone that fills it is named in that README.
