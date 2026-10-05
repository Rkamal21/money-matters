import { stubTestEnv } from './env'

// Unit tests are pure and must never reach the network or the clock by
// accident; stubbing configuration keeps a module that imports `config/env`
// from throwing at load (TESTING.md 9: no test reads the wall clock).
stubTestEnv()
