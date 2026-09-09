import js from '@eslint/js'
import boundaries from 'eslint-plugin-boundaries'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import prettier from 'eslint-config-prettier'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * ESLint 9 flat config.
 *
 * "Convention is not enforcement" (ARCHITECTURE.md §F.4). Everything below
 * encodes a rule from the architecture that we cannot afford to forget, so that
 * CI catches it rather than a reviewer on a Friday afternoon.
 *
 * The four that matter most, each an acceptance criterion for Milestone 0:
 *
 *   1. `domain/` is a leaf — no React, no Supabase, no query client, no `Date`.
 *   2. No feature or component may import the Supabase client.
 *   3. `import.meta.env` exists in exactly one file.
 *   4. Money arithmetic does not live in a component.
 */

/** The layering from ARCHITECTURE.md §F.1, as boundaries elements. */
const ELEMENTS = [
  // src/main.tsx is not listed: boundaries classifies folders, not files, and the
  // 20-line bootstrap is exempted via 'boundaries/ignore' below.
  { type: 'app', pattern: 'src/app/**', partialMatch: false },
  { type: 'domain', pattern: 'src/domain/*' },
  { type: 'data', pattern: 'src/data/*' },
  { type: 'platform', pattern: 'src/platform/*' },
  { type: 'features', pattern: 'src/features/*' },
  { type: 'components', pattern: 'src/components/*' },
  { type: 'hooks', pattern: 'src/hooks/*' },
  { type: 'lib', pattern: 'src/lib/*' },
  { type: 'config', pattern: 'src/config/**', partialMatch: false },
  { type: 'types', pattern: 'src/types/**', partialMatch: false },
]

/** Dependencies point downward only (§A.2). Read each entry as "may import". */
const POLICIES = [
  // domain/ is a leaf. It may reach its own sibling modules and nothing else.
  { from: { element: { type: 'domain' } }, allow: { to: { element: { type: 'domain' } } } },

  { from: { element: { type: 'config' } }, allow: { to: { element: { type: 'config' } } } },

  {
    from: { element: { type: 'types' } },
    allow: { to: { element: { types: { anyOf: ['types', 'domain'] } } } },
  },

  {
    from: { element: { type: 'lib' } },
    allow: { to: { element: { types: { anyOf: ['lib', 'domain', 'config', 'types'] } } } },
  },

  {
    from: { element: { type: 'hooks' } },
    allow: { to: { element: { types: { anyOf: ['hooks', 'lib', 'config', 'types'] } } } },
  },

  {
    from: { element: { type: 'data' } },
    allow: { to: { element: { types: { anyOf: ['data', 'domain', 'lib', 'config', 'types'] } } } },
  },

  {
    from: { element: { type: 'platform' } },
    allow: {
      to: { element: { types: { anyOf: ['platform', 'domain', 'lib', 'config', 'types'] } } },
    },
  },

  {
    from: { element: { type: 'components' } },
    allow: {
      to: {
        element: {
          types: { anyOf: ['components', 'hooks', 'lib', 'domain', 'config', 'types'] },
        },
      },
    },
  },

  // A feature reaches down, never sideways: no entry for `features` here, so a
  // cross-feature import fails. If two features need the same thing it moves
  // down a layer (features/README.md).
  {
    from: { element: { type: 'features' } },
    allow: {
      to: {
        element: {
          types: {
            anyOf: ['domain', 'data', 'components', 'hooks', 'lib', 'platform', 'config', 'types'],
          },
        },
      },
    },
  },

  // The composition root is allowed to know about everything at once. That is
  // what makes it the composition root.
  {
    from: { element: { type: 'app' } },
    allow: {
      to: {
        element: {
          types: {
            anyOf: [
              'app',
              'domain',
              'data',
              'platform',
              'features',
              'components',
              'hooks',
              'lib',
              'config',
              'types',
            ],
          },
        },
      },
    },
  },
]

/** Packages `domain/` may not import, because it must stay pure (§F.4). */
const IMPURE_PACKAGES = [
  'react',
  'react-*',
  'react-dom',
  'react-dom/*',
  '@supabase/*',
  '@tanstack/*',
  '@sentry/*',
  '@capacitor/*',
]

/**
 * Identifiers whose arithmetic belongs in `domain/`, not in a component.
 *
 * This is the rule behind the Milestone 0 acceptance criterion "a PR that puts
 * `(income - fixed) / 30` in a component fails lint, not review".
 *
 * ⚠ **It is a name-matching guardrail, not financial analysis** (ADR-0024).
 * No linter can decide whether an expression is a money calculation —
 * `total / count` is an average and `x / 30` is arithmetic; meaning is not in
 * the syntax tree. So this rule:
 *
 *   - catches the canonical mistake and anything spelled like it;
 *   - does **not** catch the same calculation under different variable names,
 *     and never will — review remains responsible for the general rule
 *     (ARCHITECTURE.md §F.4);
 *   - is deliberately over-broad inside its scope, because a false positive
 *     costs one comment and a false negative ships wrong money to a user;
 *   - is legitimately silenced with a justified `eslint-disable-next-line`.
 *     Reviewing that comment is where the human rule resumes.
 *
 * The real fix is types: ADR-0005 makes `Money` a value object with methods and
 * no operators, so `income - fixed` stops typechecking. That lands in M2 and
 * this rule shrinks to what types cannot reach.
 */
const MONEY_IDENTIFIERS = [
  'income',
  'incomeMinor',
  'expense',
  'expenses',
  'fixed',
  'fixedMinor',
  'variable',
  'savings',
  'savingsMinor',
  'balance',
  'balanceMinor',
  'budget',
  'budgeted',
  'planned',
  'plannedMinor',
  'limit',
  'limitMinor',
  'spent',
  'spentMinor',
  'remaining',
  'remainingMinor',
  'amount',
  'amountMinor',
  'minor',
  'total',
  'totalMinor',
  'safeDaily',
  'safeDailyLimit',
  'daysRemaining',
  'perDay',
].join('|')

const MONEY_ARITHMETIC_SELECTOR =
  `BinaryExpression[operator=/^[-*/%]$/] ` +
  `:matches(Identifier[name=/^(${MONEY_IDENTIFIERS})$/i], ` +
  `MemberExpression > Identifier.property[name=/^(${MONEY_IDENTIFIERS})$/i])`

const NO_IMPORT_META_ENV = {
  selector: "MemberExpression[object.type='MetaProperty'][property.name='env']",
  message:
    'Read configuration from src/config/env.ts, the one module allowed to touch import.meta.env.',
}

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'android/**',
      'playwright-report/**',
      'test-results/**',
      'supabase/.temp/**',
      '.husky/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,

  // ---------------------------------------------------------------- TypeScript
  {
    files: ['**/*.{ts,tsx,mts}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',

      // SECURITY.md §8.3: no console.log in src/. The v1 leak was a log line.
      'no-console': ['error', { allow: ['warn', 'error', 'info'] }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-restricted-syntax': ['error', NO_IMPORT_META_ENV],
    },
  },

  // ------------------------------------------------------------- React / a11y
  {
    files: ['src/**/*.tsx', 'tests/**/*.tsx'],
    // Both plugins still ship their recommended set with `plugins` as an array
    // of names (eslintrc shape), which flat config rejects — so the plugin is
    // registered here and only the rule map is spread.
    plugins: { 'jsx-a11y': jsxA11y, 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    files: ['src/**/*.tsx'],
    plugins: { 'react-refresh': reactRefresh },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // ----------------------------------------------------------- Layer boundary
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { boundaries },
    settings: {
      // Without a resolver that understands `.ts`/`.tsx` and the `@/` alias,
      // boundaries silently classifies every import as unknown and the whole
      // rule becomes a no-op. This line is load-bearing.
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.app.json' },
      },
      'boundaries/elements': ELEMENTS,
      'boundaries/include': ['src/**/*.ts', 'src/**/*.tsx'],
      'boundaries/ignore': ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/main.tsx'],
    },
    rules: {
      'boundaries/dependencies': ['error', { default: 'disallow', policies: POLICIES }],
      'boundaries/no-unknown-dependencies': 'error',
      'boundaries/no-unknown-files': 'off',
    },
  },

  // -------------------------------------------------- domain/ must stay pure
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: IMPURE_PACKAGES,
              message:
                'domain/ must stay pure: no React, no Supabase, no query client, no SDK. ' +
                'If this calculation needs one of those, it is not a domain calculation.',
            },
            {
              group: ['@/data/*', '@/features/*', '@/components/*', '@/app/*', '@/hooks/*'],
              message:
                'domain/ is a leaf. Dependencies point downward only (ARCHITECTURE.md §A.2).',
            },
          ],
        },
      ],

      // ROADMAP.md M0: no-restricted-globals for Date inside domain/.
      // Time enters the domain through the Clock interface, so every
      // calculation is deterministic and testable in three timezones.
      'no-restricted-globals': [
        'error',
        {
          name: 'Date',
          message:
            'domain/ must not read the clock. Take a Clock (domain/period/Clock.ts) as a ' +
            'parameter, or a LocalDate. See ADR-0006 and TESTING.md §3.2.',
        },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use the injected Clock.' },
        { object: 'Date', property: 'UTC', message: 'Use domain/period/LocalDate.' },
      ],
      'no-restricted-syntax': [
        'error',
        NO_IMPORT_META_ENV,
        {
          selector: "NewExpression[callee.name='Date']",
          message:
            'domain/ must not construct a Date from the ambient clock. Take a Clock parameter.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'domain/ must be deterministic. Inject randomness if a calculation needs it.',
        },
      ],
    },
  },

  // ------------------------------- features and components: no Supabase client
  {
    files: ['src/features/**/*.{ts,tsx}', 'src/components/**/*.{ts,tsx}', 'src/hooks/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/data/supabase/client', '@/data/supabase/*'],
              message:
                'Use a repository interface, not the Supabase client (ARCHITECTURE.md §G.1). ' +
                'data/ is the only layer that knows Supabase exists.',
            },
            {
              group: ['@supabase/*'],
              message:
                'The Supabase SDK belongs in data/. A feature talks to a repository interface.',
            },
            {
              group: ['@capacitor/*'],
              message:
                'No feature imports @capacitor/* directly. Use a port from platform/ ' +
                '(ARCHITECTURE.md §M.1).',
            },
          ],
        },
      ],
    },
  },

  // --------------------------- no money arithmetic in the presentation layers
  {
    files: [
      'src/features/**/components/**/*.{ts,tsx}',
      'src/features/**/routes/**/*.{ts,tsx}',
      'src/features/**/widgets/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/app/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        NO_IMPORT_META_ENV,
        {
          selector: MONEY_ARITHMETIC_SELECTOR,
          message:
            'Money and period arithmetic belongs in domain/, not in a component. ' +
            'Call a domain function and render its result (ARCHITECTURE.md §F.4).',
        },
      ],
    },
  },

  // ---------------------------------------------------------------- Test files
  {
    files: ['tests/**/*.{ts,tsx}', 'src/**/*.test.{ts,tsx}', 'scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-console': 'off',
      'no-restricted-syntax': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },

  // ------------------------------------------------- Plain JS: no type-checking
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off', 'no-restricted-syntax': 'off' },
  },
)
