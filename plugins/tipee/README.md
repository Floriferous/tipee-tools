# Tipee for Claude

The whole Tipee API for Claude: people, teams, shift templates, shifts,
absences, on-call duties, activities and time clock, reading and writing.
One tool per operation, named `<resource>_<verb>`. Reads are marked
read-only and deletions destructive, so your Claude client can auto-approve
reads and ask before writes; decide which tools are enabled in the client.
Not affiliated with Tipee.

## 1. Get an API key

The key belongs to an _integration_, a service account in Tipee. Someone with
admin rights on your Tipee instance does this once:

1. In the Tipee admin panel, create an integration the way you would create
   an employee, and generate its API key.
2. Grant it the authorization **Configurations générales → "Se connecter
   avec des applications externes"**. Without it, every call fails with a
   "no permissions yet" message, whatever else you grant.
3. Grant the module rights you want Claude to use: reading plannings needs
   **Planning → "Accéder au module Planning" + "Voir les plannings"** and
   **Cœur RH → "Accéder au module Cœur RH" + "Voir les collaborateurs"**;
   planning shifts needs **Planning → "Planifier"**; activities and time
   clock have their own module rights. Rights not granted simply make the
   corresponding tools fail with a clear message.

Authorizations can be granted after installing; nothing needs reinstalling.

## 2a. Install in Claude Desktop

Download `tipee-<version>.mcpb` from the "tipee-mcpb" artifact of the latest
[Verify run](https://github.com/Floriferous/tipee-tools/actions/workflows/verify.yml),
then in Claude Desktop: Settings → Extensions → Advanced settings → Install
Extension… and pick the file. Claude Desktop warns that the extension is not
verified by Anthropic; that is expected for an extension outside its
directory. Then choose Configure and enter:

- **Tipee instance**: the subdomain you sign in at, `acme` for
  `acme.tipee.net`.
- **Tipee API key**: the key from step 1. It is stored in your system
  keychain.

Claude Desktop runs the server with its own Node runtime; nothing else is
installed.

## 2b. Install in Claude Code

Requires [Node.js](https://nodejs.org) 24 or newer (`brew install node`).

```
/plugin marketplace add Floriferous/tipee-tools
/plugin install tipee@tipee-tools
```

Claude Code asks for the same two values and keeps the key in your keychain.

## 3. Check that it works

In Claude Desktop, pick the **check-tipee-setup** prompt from the "+" menu.
In Claude Code, ask Claude to run `tipee_check`. Either way Claude calls
every endpoint and tells you, in plain words, whether the setup is complete
or which authorization is still missing.

## Changing the instance or key

Claude Desktop: Settings → Extensions → Tipee → Configure. Claude Code:
disable and re-enable the plugin in `/plugin`; it prompts again.

## What it does and does not do

It can write to Tipee when the integration has the right and your client
approves the call. It returns what Tipee returns to the integration: fields
the integration may not see arrive redacted from Tipee itself.
