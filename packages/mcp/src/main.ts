// Entry point: `node src/main.ts` (or the bundled plugins/tipee/server file).
// Configuration comes from TIPEE_INSTANCE and TIPEE_API_KEY in the environment.

import { NodeRuntime } from '@effect/platform-node';
import { Layer } from 'effect';

import { ServerLayer } from './Server.ts';

NodeRuntime.runMain(Layer.launch(ServerLayer));
