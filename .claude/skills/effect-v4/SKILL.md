---
name: effect-v4
description: Writing idiomatic Effect 4 (release candidate) code in this repo — services, layers, schemas, errors, HttpClient, McpServer, testing — and the API renames that differ from Effect 3 and from most training data. Use whenever editing TypeScript under packages/.
---

# Effect 4 in tipee-tools

This repo pins `effect@4.0.0-rc.115` (and `@effect/platform-node`,
`@effect/vitest` at the same version). v4 renamed and merged a lot; most
model training data describes v3. **Read the installed sources, not memory**:
`node_modules/effect/src/<Module>.ts` (JSDoc with examples on every export)
and Effect's own agent docs in `opensrc/effect` (`pnpm docs:effect`):
`LLMS.md`, `ai-docs/src/**`, `migration/*.md`.

## Conventions (from Effect's LLMS.md, applied here)

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
- HttpClient (`effect/unstable/http`): take `yield* HttpClient.HttpClient`,
  shape it with `HttpClient.mapRequest(flow(prependUrl, acceptJson, bearerToken, setHeader))`
  and `HttpClient.retryTransient({ schedule, times })`; decode with
  `HttpClientResponse.schemaBodyJson(schema)`. Provide `FetchHttpClient.layer`
  (MSW intercepts it in tests).
- MCP (`effect/unstable/ai`): `Tool.make(name, { description, parameters, success, failure })`
  `.annotate(Tool.Readonly, true)`, `Toolkit.make(...)`, handlers with
  `toolkit.toLayer(Effect.gen(…))`, server with `McpServer.toolkit(toolkit)`
  provided `McpServer.layerStdio({ name, version, protocols: [McpProtocol.v2025_11_25, …] })`,
  `NodeStdio.layer`, and `Layer.succeed(Logger.LogToStderr, true)` (stdout is
  the protocol channel). Entry point: `NodeRuntime.runMain(Layer.launch(layer))`.
  A declared `failure` schema makes the MCP result carry `error.message`.
- Tests: `import { it, layer } from "@effect/vitest"`; `layer(L)("suite", (it) => …)`
  shares a layer; `it.effect` runs on the `TestClock` (fork with
  `Effect.forkChild`, `TestClock.adjust`, `Fiber.join` to drive retries);
  `Effect.flip` to get the error.

## RC renames and gotchas met in this repo

| Looking for (v3 / memory) | In v4 rc.115 |
| :-- | :-- |
| `Context.Tag`, `Effect.Service`, `ServiceMap.Service` | `Context.Service<Self, Shape>()("id")` |
| `Effect.fork`, `forkDaemon` | `Effect.forkChild`, `Effect.forkDetach` |
| `Config.string`, `Config.redacted` | `Config.String`, `Config.Redacted` (capitalised) |
| `Schema.filter`, `Schema.pattern` | `Schema.String.check(Schema.isPattern(re))` |
| `Schema.optional` (key may be absent) | `Schema.optionalKey` (`optional` also allows `undefined`) |
| `Schema.Schema.Any` as a generic bound | `Schema.Constraint`; for `decodeUnknownSync` use `Schema.ConstraintDecoder<unknown>` |
| `ParseResult.TreeFormatter` | `error.message` on `SchemaError` already formats the issue |
| `HttpClientResponse.isOk` | compare `response.status` yourself, or `HttpClient.filterStatusOk` |
| `@effect/platform` imports | `effect/unstable/http`, `effect/unstable/ai`; Node bits from `@effect/platform-node` |
| `Effect.fork` in `it.effect` without adjusting the clock | nothing happens: `TestClock` starts at the epoch and never advances on its own |

Modules under `effect/unstable/*` (http, ai, cli, …) may still break in a
minor release; `Schema`, `Config`, `Layer`, `Effect` are stable. Bump the
pin deliberately and rerun `pnpm verify`.

## Lint

`oxlint.config.ts` documents every rule relaxed for Effect (capitalised
constructors, anonymous generators, `_tag`, one-letter type parameters,
`Array<T>`, PascalCase module files). Don't fight the rules with disable
comments; add a commented entry there instead.
