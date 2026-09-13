// Entry point: `node src/main.ts`. Configuration comes from TIPEE_INSTANCE and
// TIPEE_API_KEY in the environment.

import { NodeRuntime } from '@effect/platform-node';

import { main } from './Server.ts';

NodeRuntime.runMain(main);
