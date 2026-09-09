import { parseEnv, type Env } from './env.schema'

/**
 * The one and only place in the repository that reads `import.meta.env`.
 *
 * Every other module imports `env` from here. A `no-restricted-syntax` rule in
 * `eslint.config.js` fails the build on `import.meta.env` anywhere else, so the
 * set of configuration a module can reach is exactly the typed object below.
 *
 * Validation runs at module load, which means a missing variable is a startup
 * error naming the variable rather than an `undefined` surfacing inside a fetch
 * three screens later.
 */
// eslint-disable-next-line no-restricted-syntax -- this file is the boundary; see config/README.md
export const env: Env = parseEnv(import.meta.env)

/** `development` | `production` | `test` -- Vite's build mode, not a variable of ours. */
// eslint-disable-next-line no-restricted-syntax -- see above
export const MODE: string = import.meta.env.MODE

// eslint-disable-next-line no-restricted-syntax -- see above
export const IS_PRODUCTION_BUILD: boolean = import.meta.env.PROD

// eslint-disable-next-line no-restricted-syntax -- see above
export const IS_DEV: boolean = import.meta.env.DEV
