# `config/` — validated configuration

`env.ts` is the **only** module in the repository permitted to read `import.meta.env`. Everything
else imports the parsed, typed `env` object. This is enforced by a `no-restricted-syntax` rule in
`eslint.config.js` that fails on `import.meta.env` anywhere outside this file.

Two properties follow from that:

1. **Fail fast, once.** A missing or malformed variable throws at module load with a message naming
   the variable, instead of surfacing as `undefined` inside a fetch three screens later.
2. **The `VITE_` allow-list is checkable.** Vite inlines every `VITE_`-prefixed variable into the
   bundle, so the allow-list here _is_ the list of values that are public by design. The Supabase
   anon key is on it deliberately — it is a public identifier and RLS is the access control
   ([SECURITY.md §1](../../docs/SECURITY.md)). A `service_role` key is not, and CI scans `dist/`
   for one on every build.

**Never add a secret here.** If a value must stay private it belongs in an Edge Function.
