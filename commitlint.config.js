/**
 * Conventional Commits, enforced in the Husky `commit-msg` hook
 * (CONTRIBUTING.md §3).
 *
 * The type and scope lists are the ones in CONTRIBUTING.md, not the defaults:
 * `db` is ours, and a scope outside the list usually means the change spans
 * more of the codebase than one commit should.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'db', 'docs', 'test', 'refactor', 'perf', 'chore', 'ci'],
    ],
    'scope-enum': [
      2,
      'always',
      [
        'auth',
        'onboarding',
        'transactions',
        'accounts',
        'budgets',
        'goals',
        'dashboard',
        'analytics',
        'gamification',
        'insights',
        'domain',
        'data',
        'ui',
      ],
    ],
    'scope-empty': [1, 'never'],
    'body-max-line-length': [1, 'always', 100],
  },
}
