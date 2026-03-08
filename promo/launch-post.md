# Launch Post — Hacker News / Reddit r/ClaudeAI / dev.to

**Title options:**
- "I asked Claude Code to build a crime data MCP plugin. 10 parallel agents shipped it in 15 minutes."
- "Show HN: neightborhood — a Claude Code plugin that aggregates live crime data from 6 sources"
- "What multi-agent parallel development actually looks like: a Claude Code plugin from idea to publish in 15 minutes"

---

## Body

A user in Sterling Heights, Michigan wanted live crime data for their neighborhood — something they could pipe into AI chatbots through MCP. They opened a Claude Code session and typed a few prompts.

Fifteen minutes later, they ran `claude plugin install neightborhood`.

This is the story of how that happened, and what it means for how software gets built.

---

### The Prompts

The user typed four things total:

1. "I live in Sterling Heights, Michigan. I'm looking for live crime data sources in my area. I would like to make an MCP app that feeds this data in a live map view to apps using the MCP app, so it can deliver this to chatbots."
2. "I'd like it to work accepting any zip code if you have generic sources, but it's most important that it covers my area well. If it supports many different live sources of data, that would be better."
3. "I think we want to make this a Claude Code plugin. publish to new repo rohenaz/neightborhood"
4. "Please remember: never do anything yourself. Always delegate tasks as often as possible and make sure adequate context and workload are supplied. Always."

Then one more: "What can we be doing in parallel?"

That last question changed how the session ran.

---

### The Agent Orchestration

Claude Code spun up 10 specialized agents. Here's what ran concurrently and for how long:

| Agent | Role | Duration |
|---|---|---|
| Researcher #1 | Crime API research focused on Sterling Heights / Macomb County | ~90s |
| Researcher #2 | Broader API evaluation — 15+ sources reviewed | ~114s |
| MCP Builder | Core TypeScript server — 6 sources, 5 tools, types, caching | ~504s |
| DevOps | git init, plugin.json, .mcp.json, GitHub repo creation | ~36s |
| Prompt Engineer #1 | crime-data SKILL.md | ~73s |
| Agent Creator | crime-analyst agent definition | ~73s |
| Prompt Engineer #2 | /crime-report slash command | ~26s |
| Plugin Validator | Structure, security, and naming validation | ~77s |
| Skill Reviewer | Skill quality and trigger effectiveness review | ~46s |
| Documentation Writer | README.md | ~47s |

Peak parallelism hit 5 agents running simultaneously. The MCP builder took the longest at ~8 minutes, but by the time it finished, the DevOps agent had already created the GitHub repo, the prompt engineers had written the skill and agent definitions, and the validator was ready to run the moment the server code landed.

Sequential development of the same scope would have taken hours. The wall-clock time was 15 minutes.

---

### What Got Built

**neightborhood** is a Claude Code plugin that accepts any US zip code and queries 6 live crime data sources in parallel:

- **SpotCrime** — incident reports with lat/lng coordinates
- **CrimeMapping.com (Axon)** — mapped incidents from police department systems
- **ArcGIS Feature Services** — Macomb County GIS layers and SEMCOG spatial data
- **NSOPW** — National Sex Offender Public Registry
- **FBI Crime Data Explorer** — historical NIBRS aggregate statistics
- **News RSS** — Google News and Patch.com local crime feeds

Five MCP tools are exposed:

```typescript
get_incidents(zip: string)
// Returns a GeoJSON FeatureCollection of crime incidents from all sources

get_crime_stats(zip: string)
// Aggregated counts by crime type and severity, with trend analysis

list_sources()
// Health check — which sources are online vs offline

get_map_html(zip: string)
// Self-contained Leaflet.js interactive map, no external runtime dependencies

get_alerts(zip: string)
// Recent crime news pulled from RSS feeds
```

Beyond the MCP server, the plugin includes a `crime-data` skill (guides Claude on when and how to use each tool), a `crime-analyst` autonomous agent for neighborhood safety analysis workflows, and a `/crime-report <zip>` slash command.

Final count: 29 source files, 3,463 lines of TypeScript. Types pass clean. Zero critical issues on the first validator run.

---

### The Technical Stack

TypeScript running on Bun, `@modelcontextprotocol/sdk` for the MCP server implementation, Zod for input validation, and Leaflet.js for map output (bundled into the HTML string so there's no dependency on an external CDN at runtime).

No required API keys. The plugin ships with a SpotCrime demo key and hits the other sources on public endpoints. Add your own FBI Crime Data Explorer key (free at api.data.gov) to unlock the historical NIBRS stats.

---

### Installation

```bash
claude plugin install neightborhood
```

Then ask Claude anything:

```
What's the crime like near 48312?
Compare safety between 48312 and 90210
Show me a map of recent incidents in this zip code
What types of crimes are trending in Sterling Heights?
```

Or use the slash command directly:

```
/crime-report 48312
```

---

### What This Actually Demonstrates

The crime data is useful. The development model is the bigger story.

Ten agents, each with a narrow scope and full context for their slice of the work, running concurrently inside a single Claude Code session. The orchestrating model handled task decomposition, dependency ordering, context passing between agents, and final integration — while the user typed fewer than 100 words of direction.

The MCP plugin format makes this composable: once built by agents, it gets consumed by agents. Any Claude Code user installs it with one command and immediately gets five new tools in their context window, an autonomous analyst, and a slash command — all wired up and ready to use.

This is what the current generation of tooling can do. The gap between "I have an idea" and "I have a working, published, installable piece of software" is collapsing fast.

---

**Repo:** https://github.com/rohenaz/neightborhood
**License:** MIT
**Install:** `claude plugin install neightborhood`
