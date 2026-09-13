# Tipee for Claude

Give Claude access to your company's Tipee: employees, teams, shifts,
absences, on-call duties, activities and time clock, reading and changing.
Not affiliated with Tipee.

Setup takes three steps, described in the
[project README](https://github.com/Floriferous/tipee-tools#readme):

1. **Get an API key from Tipee**: create an integration in the Tipee admin
   panel, grant it "Se connecter avec des applications externes" plus the
   module rights Claude should have, and generate its key.
2. **Install**: in Claude Desktop, from the downloaded extension file; in
   Claude Code, with `/plugin install tipee@tipee-tools`. Enter your instance
   and the key when asked; the key is stored in your keychain.
3. **Check**: send the **check-tipee-setup** prompt (Claude Desktop) or ask
   Claude to run `check` (Claude Code). It reports whether the setup is
   complete or what is still missing.

Claude asks before changing anything, and Claude itself asks your permission
the first time each tool is used. Which tools are enabled is decided in
Claude's settings.
