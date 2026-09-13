# Tipee for Claude

Read your company's Tipee plannings from Claude: people, teams, shift
templates, shifts, absences and on-call duties. Read-only by design. Not
affiliated with Tipee.

## 1. Get an API key

The key belongs to an _integration_, a service account in Tipee. Someone with
admin rights on your Tipee instance does this once:

1. In the Tipee admin panel, create an integration the way you would create
   an employee, and generate its API key.
2. Grant it the authorization **Configurations générales → "Se connecter
   avec des applications externes"**. Without it, every call fails with a
   "no permissions yet" message, whatever else you grant.
3. Grant read access: **Planning → "Accéder au module Planning" + "Voir les
   plannings"** and **Cœur RH → "Accéder au module Cœur RH" + "Voir les
   collaborateurs"**.

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

## What it does not do

It never writes to Tipee, and it never returns private data: the server
keeps planning fields only, so birth dates, addresses and contact details
never reach the conversation.
