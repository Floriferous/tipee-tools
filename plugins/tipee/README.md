# tipee plugin for Claude Code

Read your company's Tipee plannings from Claude: people, teams, shift
templates, shifts, absences and on-call duties. Read-only by design.

## Install

Requires [Node.js](https://nodejs.org) 24 or newer on your machine
(`brew install node` on macOS). Then, in Claude Code:

```
/plugin marketplace add Floriferous/tipee-tools
/plugin install tipee@tipee-tools
```

Claude Code asks for two values when it enables the plugin:

- **Tipee instance**: the subdomain you sign in at, `acme` for
  `acme.tipee.net`.
- **Tipee API key**: the key of an _integration_, see below. It is stored in
  your keychain and only ever sent to your Tipee instance.

Then ask Claude to run `tipee_check`. When every line says `ok`, you are done.

## Claude Desktop instead of Claude Code

The same server is packaged as a Claude Desktop extension (`.mcpb`), built
by CI and downloadable from the "tipee-mcpb" artifact of the latest Verify
run. Install it from Settings → Extensions → Advanced settings → Install
Extension…, fill in the same two values, and ask Claude to run
`tipee_check`. Claude Desktop brings its own Node runtime, so nothing else
is needed. The extension is unsigned for now; Claude Desktop warns about that
before installing.

## Creating the integration in Tipee

An integration is a service account. In the Tipee admin panel, create it like
an employee and give it roles. Until it has the authorization
**Configurations générales → "Se connecter avec des applications externes"**,
every call fails with a "no permissions yet" message, whatever else you grant.
Reading plannings also needs:

- **Planning** → "Accéder au module Planning" + "Voir les plannings"
- **Cœur RH** → "Accéder au module Cœur RH" + "Voir les collaborateurs"

Generate the API key on the integration and paste it when Claude Code asks.
Authorizations can be granted after installing; the tools pick them up
immediately.

## Changing the instance or key

Disable and re-enable the plugin in `/plugin`: Claude Code prompts again.

## What it does not do

It never writes to Tipee, and it never returns private data: the schemas
keep planning fields only, so birth dates, addresses and contact details
never reach the conversation.
