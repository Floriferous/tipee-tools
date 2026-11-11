// What the generator and the refresh share about the vendored OpenAPI
// document: where it lives, its shape, and which operations become tools.

import {
  Array as Arr,
  Effect,
  FileSystem,
  Function as Fn,
  Path,
  Predicate,
  Record as Rec,
  Schema as Codec,
  String as Str,
} from 'effect';

// This package and its spec/ directory.
export const root = Path.Path.useSync((path) => path.join(import.meta.dirname, '..'));
export const specDirectory = Path.Path.useSync((path) =>
  path.join(import.meta.dirname, '..', 'spec'),
);

// A script that cannot go on: the message says what to update.
export class SpecError extends Codec.TaggedError<SpecError, { readonly brand: unique symbol }>()(
  'SpecError',
  {
    message: Codec.String,
  },
) {}

export interface Schema {
  readonly oneOf?: ReadonlyArray<Schema>;
  readonly discriminator?: {
    readonly propertyName: string;
    readonly mapping?: Record<string, string>;
  };
  readonly properties?: Record<string, Schema>;
  readonly required?: ReadonlyArray<string>;
  readonly items?: Schema;
  readonly $ref?: string;
  readonly enum?: ReadonlyArray<string>;
  readonly description?: string;
  readonly examples?: unknown;
  readonly [key: string]: unknown;
}
// One operation of the JSON Patch generate.ts applies to the document.
export interface Patch {
  readonly op: 'add' | 'remove' | 'replace';
  readonly path: string;
  readonly value?: unknown;
}
export interface Operation {
  readonly requestBody?: unknown;
  readonly responses?: unknown;
  readonly description?: string;
}
export interface Document {
  readonly info: { readonly version: string };
  readonly paths: Record<string, Record<string, Operation>>;
  readonly components: { readonly schemas: Record<string, Schema> };
}

// The parts of the document every script reads. Decoding checks them and
// keeps the document as parsed: a decoded struct would drop the keys it does
// not name and reorder the rest, and the patch and the comparisons need them.
const Shape = Codec.Struct({
  components: Codec.Struct({ schemas: Codec.Record(Codec.String, Codec.Unknown) }),
  info: Codec.Struct({ version: Codec.String }),
  paths: Codec.Record(Codec.String, Codec.Record(Codec.String, Codec.Unknown)),
});
const isDocument = (value: unknown): value is Document => Codec.is(Shape)(value);
const decodeJson = Codec.decodeEffect(Codec.fromJsonString(Codec.Unknown));

// Parses an OpenAPI document read from `source`.
export const decodeDocument = Effect.fn('decodeDocument')(function* (text: string, source: string) {
  const document = yield* decodeJson(text);
  if (!isDocument(document)) {
    return yield* SpecError.make({ message: `${source} is not an OpenAPI document` });
  }
  return document;
});

// The one document in spec/, named tipee-<version>.json.
export const vendored = Effect.fn('vendored')(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* specDirectory;
  const specs = yield* Effect.map(fs.readDirectory(directory), Arr.filter(Str.endsWith('.json')));
  const [spec] = specs;
  if (spec === undefined || specs.length !== 1) {
    return yield* SpecError.make({
      message: `expected exactly one spec in ${directory}, found ${specs.length}`,
    });
  }
  const file = path.join(directory, spec);
  const text = yield* fs.readFileString(file);
  const document = yield* decodeDocument(text, file);
  return { document, file };
});

// Operations left out of the tools on purpose, listed before tipee's stable
// document has them (a route it lacks is skipped). Granting and revoking roles
// would let Claude raise anyone's rights, its own integration's included, and
// forcing a password change is account security: an admin does those in
// tipee. Deleting a shift template would rewrite who worked when, since past
// plannings refer to it. Listing roles is a read and stays.
export const EXCLUDED: ReadonlySet<string> = new Set([
  '/api/directory/resources.grant-roles',
  '/api/directory/resources.revoke-roles',
  '/api/schedule/schedule-templates.delete',
  '/api/security/credentials.update-must-change-password',
]);

// A JSON Pointer segment.
export const pointer = (segment: string): string =>
  Fn.pipe(segment, Str.replaceAll('~', '~0'), Str.replaceAll('/', '~1'));

// The component schemas a node refers to, directly or through other schemas.
const collect = (document: Document, node: unknown, found: Set<string>): Set<string> => {
  if (Arr.isArray(node)) {
    for (const item of node) {
      collect(document, item, found);
    }
  } else if (Predicate.isObject(node)) {
    for (const [key, value] of Rec.toEntries(node)) {
      if (key === '$ref' && Predicate.isString(value)) {
        const name = Str.replace('#/components/schemas/', '')(value);
        if (!found.has(name)) {
          found.add(name);
          collect(document, document.components.schemas[name], found);
        }
      } else {
        collect(document, value, found);
      }
    }
  }
  return found;
};
export const referenced: {
  (node: unknown): (document: Document) => ReadonlySet<string>;
  (document: Document, node: unknown): ReadonlySet<string>;
} = Fn.dual(2, (document: Document, node: unknown) => collect(document, node, new Set()));

// The routes that become tools.
export const toolRoutes = (document: Document): ReadonlyArray<string> =>
  Arr.filter(Rec.keys(document.paths), (route) => !EXCLUDED.has(route));

// A route's tool name, the way Operations.ts derives it: `schedules_list` for
// `/api/schedule/schedules.list`.
export const toolName = (route: string): string =>
  Fn.pipe(route, Str.replace(/^\/api\/[^/]+\//u, ''), Str.replaceAll(/[.-]/gu, '_'));
