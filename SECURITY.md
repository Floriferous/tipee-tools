# Security

## Reporting a vulnerability

Report it privately, through **Security → Report a vulnerability** on
[this repository](https://github.com/Floriferous/tipee-tools/security/advisories/new),
never in a public issue. Include the version Check tipee setup reports and
how to reproduce it, and never your API key or anything from your company's
tipee.

## Supported versions

Only the latest release is supported. A fix ships as a new release, which
Check tipee setup offers to every installation.

## Scope

- **The API key:** how the plugin and the extension receive, keep and send
  it. It should reach only `<instance>.tipee.net`, and never a log, a tool
  result, an error or telemetry.
- **The update download:** `update_plugin` downloads the extension from this
  repository's GitHub releases and checks it against the release's
  `SHA256SUMS` before opening it.
- **The telemetry payload:** what the plugin sends to PostHog, described in
  the [README](README.md#privacy-and-telemetry). Anything beyond it, such as
  tipee's answers or details about people, is a vulnerability.

tipee itself, its API and the rights an integration is granted there are
out of scope: report those to tipee.
