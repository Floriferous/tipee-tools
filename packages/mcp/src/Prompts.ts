// MCP prompts: ready-made requests a client can offer in its menu. The
// Setup prompt is the first thing a non-technical user should run.

import { Effect } from 'effect';
import { McpServer } from 'effect/unstable/ai';

export const SETUP_PROMPT = {
  description: 'Check that the Tipee connection works and explain any missing authorization.',
  name: 'check-tipee-setup',
  text:
    'Run the check tool with no arguments. Then explain the result for someone who is ' +
    'not technical. If every endpoint is ok, say the setup is complete and give three examples ' +
    'of questions I can ask about my plannings. If the tool fails or an endpoint reports an ' +
    'error, quote the message, say exactly which authorization to grant in the Tipee admin ' +
    'panel (Configurations générales → "Se connecter avec des applications externes", then ' +
    'access to the modules concerned, such as Planning → "Accéder au module Planning" and ' +
    '"Voir les plannings", or Cœur RH → "Accéder au module Cœur RH" and "Voir les ' +
    'collaborateurs"), and tell me to run this check again afterwards. If the message says ' +
    'the key was rejected, tell me to re-enter the instance and the key in the extension ' +
    'settings. If the result mentions an update, tell me the new version in one sentence and ' +
    'ask whether I want to install it now. If I say yes, call the update tool and relay its ' +
    'message: when Claude Desktop asks for confirmation, tell me to click Update there.',
};

export const SetupPrompt = McpServer.prompt({
  content: () => Effect.succeed(SETUP_PROMPT.text),
  description: SETUP_PROMPT.description,
  name: SETUP_PROMPT.name,
});
