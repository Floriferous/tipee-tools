import { defineConfig } from 'oxlint';

export default defineConfig({
  categories: {
    correctness: 'error',
    nursery: 'off',
    pedantic: 'error',
    perf: 'error',
    restriction: 'error',
    style: 'error',
    suspicious: 'error',
  },
  env: {
    es6: true,
    node: true,
  },
  ignorePatterns: ['.git/**', '**/node_modules/**', '**/dist/**'],
  overrides: [
    {
      // Build-tool configs run in Node and are the one place `process.env` belongs.
      files: ['**/*.config.{ts,mjs}'],
      rules: {
        'node/no-process-env': 'off',
      },
    },
    {
      // The CLI entry point: reads its configuration from the environment and
      // Is executed directly by Node, never `require`d.
      files: ['packages/cli/src/main.ts'],
      rules: {
        'node/no-process-env': 'off',
        'node/no-top-level-await': 'off',
      },
    },
  ],
  // This list replaces the default plugin set; it repeats the defaults and adds
  // `import`, `jsdoc`, `node` and `promise`.
  plugins: ['import', 'jsdoc', 'node', 'oxc', 'promise', 'typescript', 'unicorn'],
  rules: {
    // Retry/backoff and cursor pagination are inherently sequential.
    'eslint/no-await-in-loop': 'off',
    // The import plugin's consistent-type-specifier-style splits type imports
    // Into their own statement; without this option the two rules conflict.
    'eslint/no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    // Too many edge cases (like 0) make this rule unbearable.
    'eslint/no-magic-numbers': 'off',
    // Ternaries improve readability in declarative code.
    'eslint/no-ternary': 'off',
    // A JSON API client models absent values as undefined explicitly.
    'eslint/no-undefined': 'off',
    // Still in nursery, but mature upstream ESLint rules; remove once they graduate.
    'eslint/no-unreachable-loop': 'error',
    'eslint/no-useless-assignment': 'error',
    // Merging every declaration into one comma-separated statement hurts readability.
    'eslint/one-var': 'off',
    // Thin wrappers forward promises without awaiting; on them this rule
    // Conflicts with promise-function-async (their fixers ping-pong).
    'eslint/require-await': 'off',
    // Named exports declared inline, default exports only where tooling requires them.
    'import/exports-last': 'off',
    'import/group-exports': 'off',
    'import/no-default-export': 'off',
    'import/no-named-export': 'off',
    // These packages are Node tools; importing Node builtins is intended.
    'import/no-nodejs-modules': 'off',
    'import/no-relative-parent-imports': 'off',
    'import/prefer-default-export': 'off',
    // Async/await is idiomatic here.
    'oxc/no-async-await': 'off',
    // Wrapping the global setTimeout in a promise is the one delay that
    // Vitest's fake timers can intercept (timers/promises bypasses them).
    'promise/avoid-new': 'off',
    // We prefer TypeScript return type inference for less noisy code.
    'typescript/explicit-function-return-type': 'off',
    // Still in nursery, but the underlying typescript-eslint rules are mature.
    'typescript/no-unnecessary-condition': 'error',
    // Tests narrow parsed JSON output to the shape they assert on.
    'typescript/no-unsafe-type-assertion': 'off',
    'typescript/prefer-optional-chain': 'error',
    'typescript/prefer-readonly-parameter-types': 'off',
    // Tipee's wire format uses literal null (e.g. the first pagination
    // Cursor); the fixer would silently replace it with undefined, which
    // JSON.stringify drops — and Tipee then rejects the request.
    'unicorn/no-null': 'off',
    // Still in nursery, but a mature upstream rule; remove once it graduates.
    'unicorn/no-useless-iterator-to-array': 'error',
    // Its fixer uppercases hex literals and oxfmt lowercases them back.
    'unicorn/number-literal-case': 'off',
  },
});
