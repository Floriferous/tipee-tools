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
  ignorePatterns: [
    '.git/**',
    '**/node_modules/**',
    '**/dist/**',
    'plugins/*/server/**',
    'opensrc/**',
  ],
  overrides: [
    {
      // Build-tool configs run in Node and are the one place `process.env` belongs.
      files: ['**/*.config.{ts,mjs}'],
      rules: {
        'node/no-process-env': 'off',
      },
    },
    {
      // Tests spawn the server as a child process with a controlled environment.
      files: ['packages/*/test/**/*.ts'],
      rules: {
        'node/no-process-env': 'off',
      },
    },
    {
      // The MCPB manifest carries literal `${__dirname}` / `${user_config.x}`
      // Placeholders that Claude Desktop substitutes at install time.
      files: ['plugins/*/scripts/**/*.ts'],
      rules: {
        'eslint/no-template-curly-in-string': 'off',
      },
    },
  ],
  // This list replaces the default plugin set; it repeats the defaults and adds
  // `import`, `jsdoc`, `node` and `promise`.
  plugins: ['import', 'jsdoc', 'node', 'oxc', 'promise', 'typescript', 'unicorn'],
  // Rules are sorted by name. Most exemptions exist because Effect's idioms
  // (capitalised constructors, generators, `_tag`, `A`/`E`/`R` type parameters,
  // Long declarative layers) contradict rules written for plain TypeScript.
  rules: {
    // Tagged errors expose `get message()` without touching `this` when the
    // Text is constant.
    'eslint/class-methods-use-this': 'off',
    // `Effect.gen(function* () {})` and `Effect.fn("name")(function* () {})`
    // Take anonymous generators; the span name is the function's name.
    'eslint/func-names': 'off',
    // Effect's type parameters are `A`, `E`, `R`, `S`: one letter by convention.
    'eslint/id-length': 'off',
    // A module holds every error class of its domain (`Errors.ts`).
    'eslint/max-classes-per-file': 'off',
    // Layer factories, toolkits and test suites are one long, declarative
    // Function each.
    'eslint/max-lines-per-function': 'off',
    'eslint/max-statements': 'off',
    // Effect's public API is built from capitalised constructors called without
    // `new` (`Schema.String`, `Config.Redacted`, `Schema.Struct({})`).
    'eslint/new-cap': 'off',
    // Retry/backoff and cursor pagination are inherently sequential.
    'eslint/no-await-in-loop': 'off',
    // The import plugin's consistent-type-specifier-style splits type imports
    // Into their own statement; without this option the two rules conflict.
    'eslint/no-duplicate-imports': ['error', { allowSeparateTypeImports: true }],
    // Too many edge cases (like 0) make this rule unbearable.
    'eslint/no-magic-numbers': 'off',
    // A schema and its type share a name (`DateRange`): value and type namespaces.
    'eslint/no-redeclare': 'off',
    // `layer(L)('suite', (it) => …)` from @effect/vitest shadows the imported
    // `it` on purpose.
    'eslint/no-shadow': ['error', { allow: ['it'] }],
    // Ternaries improve readability in declarative code.
    'eslint/no-ternary': 'off',
    // A JSON API client models absent values as undefined explicitly.
    'eslint/no-undefined': 'off',
    // `_tag` is Effect's discriminant.
    'eslint/no-underscore-dangle': 'off',
    // Still in nursery, but mature upstream ESLint rules; remove once they graduate.
    'eslint/no-unreachable-loop': 'error',
    // A service's static `layer` refers to a `make` declared after the class;
    // The reference is inside an arrow, so it is resolved lazily.
    'eslint/no-use-before-define': ['error', { functions: false, variables: false }],
    'eslint/no-useless-assignment': 'error',
    // Merging every declaration into one comma-separated statement hurts readability.
    'eslint/one-var': 'off',
    // Thin wrappers forward promises without awaiting; on them this rule
    // Conflicts with promise-function-async (their fixers ping-pong).
    'eslint/require-await': 'off',
    // Imports are sorted by oxfmt (`sortImports`), which also fixes them.
    'eslint/sort-imports': 'off',
    // Named exports declared inline, default exports only where tooling requires them.
    'import/exports-last': 'off',
    'import/group-exports': 'off',
    'import/no-default-export': 'off',
    'import/no-named-export': 'off',
    // These packages are Node tools; importing Node builtins is intended.
    'import/no-nodejs-modules': 'off',
    'import/no-relative-parent-imports': 'off',
    'import/prefer-default-export': 'off',
    // `Schema.decodeUnknownSync` is a name, not a blocking syscall.
    'node/no-sync': 'off',
    // Async/await is idiomatic here.
    'oxc/no-async-await': 'off',
    // Public-surface `index.ts` files re-export their package on purpose.
    'oxc/no-barrel-file': 'off',
    // Optional chaining and object spread are plain modern TypeScript.
    'oxc/no-optional-chaining': 'off',
    'oxc/no-rest-spread-properties': 'off',
    // The stdio test wraps a JSON-RPC round trip in a promise.
    'promise/avoid-new': 'off',
    // Effect spells arrays `Array<T>` / `ReadonlyArray<T>`.
    'typescript/array-type': ['error', { default: 'generic', readonly: 'generic' }],
    // We prefer TypeScript return type inference for less noisy code.
    'typescript/explicit-function-return-type': 'off',
    // Service shapes declare methods (`people(filter?): Effect<...>`) like Effect's docs.
    'typescript/method-signature-style': 'off',
    // Still in nursery, but the underlying typescript-eslint rules are mature.
    'typescript/no-unnecessary-condition': 'error',
    // Tests narrow parsed JSON output to the shape they assert on.
    'typescript/no-unsafe-type-assertion': 'off',
    'typescript/prefer-optional-chain': 'error',
    'typescript/prefer-readonly-parameter-types': 'off',
    // Helpers next to the layer that uses them read better than hoisted ones.
    'unicorn/consistent-function-scoping': 'off',
    // Effect modules are PascalCase files (`TipeeClient.ts`), like Effect itself.
    'unicorn/filename-case': ['error', { cases: { kebabCase: true, pascalCase: true } }],
    // `.pipe(a, b, c)` chains nest calls by design.
    'unicorn/max-nested-calls': 'off',
    // `Effect.map(self, f)` data-first calls look like `array.map(f, thisArg)`.
    'unicorn/no-array-method-this-argument': 'off',
    // Tipee's wire format uses literal null (e.g. the first pagination
    // Cursor); the fixer would silently replace it with undefined, which
    // JSON.stringify drops — and Tipee then rejects the request.
    'unicorn/no-null': 'off',
    // Still in nursery, but a mature upstream rule; remove once it graduates.
    'unicorn/no-useless-iterator-to-array': 'error',
    // Its fixer uppercases hex literals and oxfmt lowercases them back.
    'unicorn/number-literal-case': 'off',
    // Errors are yielded (`yield* new TipeeError(...)`), never thrown.
    'unicorn/throw-new-error': 'off',
  },
});
