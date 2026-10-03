---
name: effect-v4
description: Writing idiomatic Effect 4 code in this repo — services, layers, schemas, errors, HttpClient, McpServer, testing — and the API renames that differ from Effect 3 and from most training data. Use whenever editing TypeScript under packages/.
---

# Effect 4 in tipee-tools

This repo pins `effect@4.0.0` (and `@effect/platform-node`,
`@effect/vitest` at the same version). v4 renamed and merged a lot; most
model training data describes v3. **Read the installed sources, not memory**:
`packages/core/node_modules/effect/src/<Module>.ts` (JSDoc with examples on
every export; pnpm links `effect` into each package, not the root), and
Effect's own agent docs shipped beside them:
`packages/core/node_modules/effect/AGENTS.md` and
`packages/core/node_modules/effect/ai-docs/`.

## Conventions (from Effect's AGENTS.md, applied here)

- `Effect.gen(function* () { … })` inline; `Effect.fn("Name.method")(function* (…) { … })`
  for reusable functions (the string becomes the span name). Never wrap a
  bare `Effect.gen` in a function just to name it.
- Services: `class X extends Context.Service<X, { … }>()("@tipee-tools/core/X") {}`
  with `static readonly layer = Layer.effect(X, Effect.gen(…))` returning
  `X.of({ … })`. Config-driven layers use `Layer.unwrap` (see `TipeeClient.layerConfig`).
- Errors: `class E extends Schema.TaggedError<E>()("E", { fields })` with an
  `override get message()` that says what to do. One umbrella error with a
  tagged `reason` field (`TipeeError`) so callers use `Effect.catchReason`.
  Fail with `return yield* new E(…)`, never `throw`.
- Schemas: `Schema.Struct`, `Schema.Class<T>("id")({ … })` for named entities,
  `Schema.String.check(Schema.isPattern(re))`, `Schema.NullOr`,
  `Schema.optionalKey` for optional JSON keys, `Schema.Literals([…])`,
  `Schema.Union([…])`. Decoding strips unknown keys by default. Types:
  `typeof S.Type`. Descriptions via `.annotate({ description })` (they reach
  the MCP JSON Schema).
- HttpClient (`effect/http`): take `yield* HttpClient.HttpClient`,
  shape it with `HttpClient.mapRequest(flow(prependUrl, acceptJson, bearerToken, setHeader))`
  and retries with `HttpClient.transformResponse` (`Effect.repeat` on
  transient responses, `Effect.retry` on errors; see `TipeeClient.ts` for why
  not `retryTransient`); decode with
  `HttpClientResponse.schemaBodyJson(schema)`. Provide `FetchHttpClient.layer`
  (MSW intercepts it in tests).
- MCP (`effect/ai`): `Tool.make(name, { description, parameters, success, failure })`
  `.annotate(Tool.Readonly, true)`, `Toolkit.make(...)`, handlers with
  `toolkit.toLayer(Effect.gen(…))`, server with `McpServer.toolkit(toolkit)`
  provided `McpServer.layerStdio({ name, version, protocols: [McpProtocol.v2025_11_25, …] })`
  and `NodeStdio.layer`. Entry point: `NodeRuntime.runMain(Layer.launch(layer))`,
  the effect wrapped in `Effect.provideService(Logger.LogToStderr, true)` and
  logging its own failure, with `{ disableErrorReporting: true }`: stdout is
  the protocol channel, and a failed start must not land there (see `start`
  in `packages/mcp/src/Start.ts`).
  A declared `failure` schema makes the MCP result carry `error.message`.
- Tests: `import { it, layer } from "@effect/vitest"`; `layer(L)("suite", (it) => …)`
  shares a layer; `it.effect` runs on the `TestClock` (fork with
  `Effect.forkChild`, `TestClock.adjust`, `Fiber.join` to drive retries;
  when the effect also waits on real I/O such as MSW, step the clock in a
  loop instead, as `settled` in `packages/core/test/answers.ts` does);
  `Effect.flip` to get the error.

## v4 renames and gotchas met in this repo

| Looking for (v3 / memory)                                | In v4                                                                                |
| :------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| `Context.Tag`, `Effect.Service`, `ServiceMap.Service`    | `Context.Service<Self, Shape>()("id")`                                               |
| `Effect.fork`, `forkDaemon`                              | `Effect.forkChild`, `Effect.forkDetach`                                              |
| `Config.string`, `Config.redacted`                       | `Config.String`, `Config.Redacted` (capitalised)                                     |
| `Schema.filter`, `Schema.pattern`                        | `Schema.String.check(Schema.isPattern(re))`                                          |
| `Schema.optional` (key may be absent)                    | `Schema.optionalKey` (`optional` also allows `undefined`)                            |
| `Schema.Schema.Any` as a generic bound                   | `Schema.Constraint`; for `decodeUnknownSync` use `Schema.ConstraintDecoder<unknown>` |
| `ParseResult.TreeFormatter`                              | `error.message` on `SchemaError` already formats the issue                           |
| `HttpClientResponse.isOk`                                | compare `response.status` yourself, or `HttpClient.filterStatusOk`                   |
| `@effect/platform` imports                               | `effect/http`, `effect/ai`; Node bits from `@effect/platform-node`                   |
| `Effect.fork` in `it.effect` without adjusting the clock | nothing happens: `TestClock` starts at the epoch and never advances on its own       |

Since 4.0.0-rc.118 the former `effect/unstable/*` modules live at the top level
(`effect/http`, `effect/http-api`, `effect/ai`, `effect/cli`, …) but are still
marked `@stability unstable` and may break in a minor release; `Schema`,
`Config`, `Layer`, `Effect` are stable. The tsconfigs turn off the
`unstableApiUsage` diagnostic because depending on them is deliberate.
Renovate moves `effect` and the `@effect/*` packages (except `@effect/tsgo`)
together as one group; read that PR's diff and rerun `pnpm verify` before
merging.

## Type-checking and diagnostics

TypeScript 7 is the native compiler. `@effect/tsgo` is installed at the root
and patched into `typescript` and `oxlint-tsgolint` by the `prepare` script,
so `pnpm check`, `pnpm lint` and the editor (VS Code with the TypeScript 7
extension, see `.vscode/settings.json`) all surface Effect diagnostics.
`pnpm exec effect-tsgo diagnostics --project <tsconfig> --strict` prints them
on their own. Do not add `@effect/language-service`: it is the pre-7 plugin
(the `plugins` entries in the tsconfigs carry that name only because it is
the name `@effect/tsgo` reads).

## Lint

`oxlint.config.ts` documents every rule relaxed for Effect (capitalised
constructors, anonymous generators, `_tag`, one-letter type parameters,
`Array<T>`, PascalCase module files). Don't fight the rules with disable
comments; add a commented entry there instead.
