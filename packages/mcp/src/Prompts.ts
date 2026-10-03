// MCP prompts: ready-made requests a client can offer in its menu. The
// setup prompt is the first thing a non-technical user should run.

import { SETTINGS } from '@tipee-tools/core';
import { Effect } from 'effect';
import { McpServer } from 'effect/ai';

export const SETUP_PROMPT = {
  description: 'Check that the Tipee connection works and explain any missing authorization.',
  name: 'check-tipee-setup',
  text:
    'Run the check_setup tool with no arguments, then explain the result to someone who is ' +
    'not technical. For each endpoint that is not ok, quote its error as is: it names the ' +
    'right to tick and links the page where to tick it. A module the company does not use can ' +
    'stay off: say so rather than asking me to turn it on. If the tool itself fails, quote ' +
    `its message and follow the fix it gives; the instance and the key are in ${SETTINGS}. ` +
    'Tell me to run this check again after changing anything. Then give three examples of ' +
    'questions I can ask, using only endpoints that are ok. If the result mentions an update, ' +
    'tell me the new version in one sentence and ask whether I want to install it now. If I ' +
    'say yes, call update_plugin and relay its message: when Claude Desktop asks for ' +
    'confirmation, tell me to click Update there.',
  title: 'Check Tipee setup',
};

export const SetupPrompt = McpServer.prompt({
  content: () => Effect.succeed(SETUP_PROMPT.text),
  description: SETUP_PROMPT.description,
  name: SETUP_PROMPT.name,
  title: SETUP_PROMPT.title,
});
