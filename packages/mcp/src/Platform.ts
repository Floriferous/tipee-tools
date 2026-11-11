// The Node implementations of Effect's platform services the server uses
// besides stdio and HTTP: files and paths for the downloaded update, the
// opener's child process, and the digests and random ids of the update check
// and telemetry. One layer, so the services that need them share one build.

import { layer as childProcessLayer } from '@effect/platform-node/NodeChildProcessSpawner';
import { layerDigest, layerSecureRandom } from '@effect/platform-node/NodeCrypto';
import { layer as fileSystemLayer } from '@effect/platform-node/NodeFileSystem';
import { layer as pathLayer } from '@effect/platform-node/NodePath';
import { Layer } from 'effect';
import type { FileSystem, Path } from 'effect';
import type { Digest, SecureRandom } from 'effect/crypto';
import type { ChildProcessSpawner } from 'effect/process';

export const NodePlatform: Layer.Layer<
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | FileSystem.FileSystem
  | Path.Path
  | SecureRandom.SecureRandom
> = Layer.mergeAll(
  childProcessLayer.pipe(Layer.provideMerge(Layer.merge(fileSystemLayer, pathLayer))),
  layerDigest,
  layerSecureRandom,
);
