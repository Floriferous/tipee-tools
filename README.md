# Tipee for Claude

Give Claude access to your company's [Tipee](https://tipee.ch): employees,
teams, shifts, absences, on-call duties, activities and time clock. Claude
can look things up and, when you ask, change them.

Everything Tipee's API offers is available as a tool. Which tools Claude may
use, and which need your approval, is up to you in Claude's own settings.
Not affiliated with Tipee.

## 1. Get an API key from Tipee

Tipee talks to Claude through an _integration_, a kind of service account.
Two admin steps, done once per company:

1. **Turn the API on**, at
   `https://<instance>.tipee.net/admin/instance/integrations/`. Only an
   admin with the **Responsable API** role can do this.
2. **Create the integration**, at
   `https://<instance>.tipee.net/hr-core/integrations`: create it, generate
   its API key, and tick its rights. Two matter for everything:
   **Configurations générales → "Se connecter avec des applications
   externes"**, without which nothing works, and then the rights for what
   Claude should be able to do, for example **Planning → "Voir les
   plannings"** to read plannings, **Planning → "Planifier"** to change them,
   **Cœur RH → "Voir les collaborateurs"** for people. Rights can be added
   later; the change is immediate.

Keep the key somewhere safe; you will paste it once during installation.

## 2. Install in Claude Desktop

1. Download [tipee.mcpb](https://github.com/Floriferous/tipee-tools/releases/latest/download/tipee.mcpb).
2. In Claude Desktop, open **Settings → Extensions → Advanced settings →
   Install Extension…** and pick the file. Claude Desktop will warn that the
   extension is not verified by Anthropic; that is expected for an extension
   installed from a file.
3. Click **Configure** and enter your Tipee instance (the part before
   `.tipee.net` in the address you sign in at) and the API key. The key goes
   into your system keychain.
4. Start a new chat, open the **+** menu, pick **check-tipee-setup**, and
   send it. Claude checks every part of the setup and tells you, in plain
   words, whether it is complete or what is still missing.

To change the instance or the key later: **Settings → Extensions → Tipee →
Configure**.

### Or ask your agent to set it up

If you use Claude Code, ask it to install the `tipee` plugin from the
`Floriferous/tipee-tools` marketplace, or run:

```
/plugin marketplace add Floriferous/tipee-tools
/plugin install tipee@tipee-tools
```

It asks for the same two values, and comes with a skill that teaches Claude
how to work with Tipee. Then ask it to run `check`.

## Updating

Claude tells you when a newer version exists, whenever you run the setup
check, and offers to install it. Say yes: in Claude Desktop it downloads the
release and Claude Desktop asks you to confirm the update, keeping your
instance and key. In Claude Code, run `/plugin marketplace update tipee-tools`
then `/plugin update tipee`, or turn on auto-update for the marketplace once
under `/plugin`.

## 3. Ask away

Some things people ask:

- Who is working on Thursday, and who is on call this weekend?
- Is anyone absent next week in the Geneva team?
- What is Alice's activity rate, and how has it changed?
- Plan Bruno on the morning shift on Monday and Tuesday.
- Record Chloé's vacation from the 3rd to the 7th.
- How many hours went into project X this month?

Claude looks things up freely. Before it changes anything it tells you
exactly what will change and waits for your yes, and Claude Desktop asks for
your permission on each tool the first time it is used.

## Telemetry

The plugin collects usage data to help improve it: which tools were called,
how long they took, the errors they hit, and the name of your Tipee instance
so companies can be told apart. It never sends your key, anything Tipee
answered, or anything about the people in Tipee; installations are counted
by a random id.

## Development

Requires Node 24 and pnpm (`corepack enable`).

```bash
pnpm install
pnpm verify   # everything CI runs: lint, format, types, tests, bundle
pnpm fix      # apply the fixers and rebuild the plugin
```

The tools are generated from Tipee's OpenAPI document, so the plugin cannot
drift from the API; a new Tipee version is a new document in
`packages/core/spec` and a `pnpm fix`. [ARCHITECTURE.md](ARCHITECTURE.md)
explains the design, and the skills in `.claude/skills` brief agents working
in this repository.
