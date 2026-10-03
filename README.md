# Tipee for Claude

Give Claude access to your company's [Tipee](https://tipee.ch): employees,
teams, shifts, absences, on-call duties, activities and time clock. Claude
can look things up and, when you ask, change them.

Every operation of Tipee's API is available as a tool, except granting and
revoking roles, which stays with an admin in Tipee. Which tools Claude may
use, and which need your approval, is up to you in Claude's own settings.
An independent project, not made or endorsed by Tipee.

## 1. Get an API key from Tipee

Tipee talks to Claude through an _integration_, a kind of service account.
Two admin steps, done once per company:

1. **Turn the API on**, at
   `https://<instance>.tipee.net/admin/instance/integrations/`. Only an
   admin with the **Responsable API** role can do this.
2. **Create the integration**, at
   `https://<instance>.tipee.net/hr-core/integrations`: create it, generate
   its API key, and tick its rights. **Configurations générales → "Se
   connecter avec des applications externes"** is needed for everything.
   Then tick the rights for what Claude should do, each module's access
   right included. For example, to read plannings and people: **Planning →
   "Accéder au module Planning"** and **"Voir les plannings"**, **Cœur RH →
   "Accéder au module Cœur RH"** and **"Voir les collaborateurs"**; to change
   plannings, **Planning → "Planifier"** as well. The
   [full table](plugins/tipee/skills/tipee/roles.md) lists the rights of
   every tool. Rights can be added later; the change is immediate.

Keep the key somewhere safe; you will paste it once during installation.

## 2. Install in Claude Desktop

1. Download [tipee.mcpb](https://github.com/Floriferous/tipee-tools/releases/latest/download/tipee.mcpb).
2. Open the downloaded file (double-click it, or drag it into Claude
   Desktop); if nothing happens, use **Settings → Extensions → Advanced
   settings → Install Extension…**. Claude Desktop will warn that the
   extension is not verified by Anthropic; that is expected for an extension
   installed from a file.
3. Click **Configure** and enter your Tipee instance (the part before
   `.tipee.net` in the address you sign in at) and the API key.
4. Start a new chat, open the **+** menu, pick **check-tipee-setup** (Check
   Tipee setup), and send it. Claude checks every part of the setup and
   tells you, in plain words, whether it is complete or what is still
   missing, a mistyped instance or key included.

To change the instance or the key later: **Settings → Extensions → Tipee for
Claude → Configure**. On Team and Enterprise plans, an owner can upload
`tipee.mcpb` once for the whole organization; each person still enters the
instance and a key.

### Or install in Claude Code

Claude Code needs Node.js 22.19 or newer on its PATH (check with
`node --version`); Claude Desktop brings its own. Then run:

```
/plugin marketplace add Floriferous/tipee-tools
/plugin install tipee@tipee-tools
```

It asks for the same two values, and comes with a skill that teaches Claude
how to work with Tipee. Then run **Check Tipee setup**: type
`check-tipee-setup` after `/` and pick the Tipee entry, or ask Claude to run
`check_setup`. To change the instance or the key later: `/plugin` →
Installed → tipee.

## 3. Ask away

Some things people ask:

- Who is working on Thursday, and who is on call this weekend?
- Is anyone absent next week in the Geneva team?
- What is Alice's activity rate, and how has it changed?
- Plan Bruno on the morning shift on Monday and Tuesday.
- Record Chloé's vacation from the 3rd to the 7th.
- How many hours went into project X this month?

Claude looks things up freely. Every tool that changes Tipee instructs Claude
to tell you exactly what will change and to wait for your yes first, unless
you asked for that exact change. Claude Desktop also asks your permission for
each tool: choose **Allow once** to approve every change yourself.

## Updating

When you run Check Tipee setup, Claude tells you whether a newer version
exists and offers to install it. Say yes, then:

- **Claude Desktop on a Mac** shows its update dialog: click Update. Your
  instance and key are kept.
- **Claude Desktop on Windows**: Claude downloads the new version and says
  where it saved it. Double-click that file and confirm the update.
- **Claude Code**: run `claude plugin update tipee@tipee-tools` in a terminal
  (Claude Code can run it for you), then /reload-plugins, or use `/plugin` →
  Installed → tipee → Update now. To get updates on their own, turn on
  auto-update for the `tipee-tools` marketplace under `/plugin`; it is off by
  default for marketplaces other than Anthropic's.

## Removing

1. Uninstall the way you installed: in Claude Desktop, **Settings →
   Extensions → Tipee for Claude → Uninstall**; in Claude Code,
   `/plugin uninstall tipee@tipee-tools`.
2. Delete the `.tipee-tools` folder in your home directory, if there is one:
   versions before 1.0 kept update checks there.
3. Most important: in Tipee, at `https://<instance>.tipee.net/hr-core/integrations`,
   delete the integration or regenerate its key, so the key Claude had stops
   working.

## Compatibility

- Built against Tipee API 26.06.25; a weekly job picks up the documents Tipee
  publishes, and a new release follows.
- Claude Desktop on macOS or Windows (the Linux beta is untested), or Claude
  Code with Node.js 22.19 or newer.
- Versions follow semver. A major version renames or removes a tool, a
  setting, or the plugin or marketplace name, including when Tipee drops an
  operation; new tools make a minor version; fixes make a patch.

## Help

Run **Check Tipee setup** first: its answer names most problems and how to
fix them, and the version you run. If that does not help,
[open an issue](https://github.com/Floriferous/tipee-tools/issues) with its
output, the version included. Never paste your API key. Report a security
problem privately instead, as [SECURITY.md](SECURITY.md) explains.

## Privacy and telemetry

The plugin sends usage data to PostHog's EU cloud (`eu.i.posthog.com`), with
IP addresses discarded, to help improve it:

- which tools were called, how long they took and how they ended;
- errors, by their reason, HTTP status, Tipee's error code (such as
  `OVERLAPPING`) and, for an answer that changed shape, the paths of the
  fields concerned; never with Tipee's text. Crashes carry their message and
  stack trace, with file paths cut down to file names;
- with each event: your Tipee instance name, so companies can be told apart,
  the operating system, CPU architecture, Node.js version, how the plugin was
  installed, which Claude app and version calls it, the plugin and Tipee API
  versions, and a random ID for each time the plugin starts.

It never sends your key, anything Tipee answered, or anything about the
people in Tipee. Each installation is counted under an ID computed from your
computer and account names: the names are never sent, but the ID is
pseudonymous rather than anonymous, since anyone who knows them can compute
it.

On a company network, the plugin needs `<instance>.tipee.net`, plus
`api.github.com`, `github.com` and `*.githubusercontent.com` for updates. It
trusts the certificates installed on the computer, so networks that inspect
HTTPS work, and it goes through the proxy set in the `HTTPS_PROXY`
environment variable where Node.js supports it. `eu.i.posthog.com` can be
blocked without harm.

## Development

Requires Node 24 and pnpm.

```bash
pnpm install
pnpm verify   # everything CI runs: lint, format, types, tests, bundle
pnpm fix      # apply the fixers and rebuild the plugin
```

The tools are generated from Tipee's OpenAPI document, vendored in
`packages/core/spec`. Tipee refines that document, sometimes within a
published version, so a workflow runs `pnpm spec:refresh` every Monday: it
downloads the newest stable document, regenerates the tools and, when
anything changed, opens a PR listing the operations and schemas that moved,
with the version bumped. Review it and merge it: merging a version bump
publishes the release. Run `pnpm spec:refresh` yourself to do the same
locally. [ARCHITECTURE.md](ARCHITECTURE.md) explains the design, and the
skills in `.claude/skills` brief agents working in this repository.
