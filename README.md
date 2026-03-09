<div align="center">

<img src=".github/hero-banner.jpg" alt="neighborhood — Live crime data for AI agents" />

# neighborhood

**Live crime data for AI agents.** 6 sources. 5 tools. Any US zip code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

A Claude Code plugin that aggregates live crime data from six public sources and exposes it through MCP tools. Accepts any US zip code and returns unified GeoJSON, statistics, interactive maps, and news alerts.

Optimized for Austin, TX (Travis County) but works nationwide.

## Quick Start

```bash
# Install as a Claude Code plugin
claude plugin install neighborhood
```

Then ask Claude:

```
What's the crime like near 78701?
```

Or run the slash command:

```
/crime-report 78701
```

## Data Sources

| Source | Data Type | Updates | Auth |
|---|---|---|---|
| SpotCrime | Incident reports with lat/lng | Daily | Optional (demo key included) |
| CrimeMapping.com (Axon) | Mapped incidents from police departments | Live | None |
| ArcGIS Feature Services | Travis County GIS + spatial data | Live | None |
| NSOPW | National Sex Offender Public Registry | Live | None |
| FBI Crime Data Explorer | Historical NIBRS aggregate statistics | Annual | Free API key |
| News RSS | Google News + Patch.com local crime news | Live | Optional |

## MCP Tools

| Tool | Description |
|---|---|
| `get_incidents` | GeoJSON FeatureCollection of crime incidents by zip code |
| `get_crime_stats` | Aggregated counts by type and severity, with trend analysis |
| `list_sources` | Check which data sources are online or offline |
| `get_map_html` | Self-contained Leaflet.js interactive crime map (no dependencies) |
| `get_alerts` | Recent crime news pulled from RSS feeds |

## Plugin Components

- **MCP server** — TypeScript, runs via Bun, exposes the five tools above
- **`skills/crime-data/`** — guides Claude on how and when to use each tool
- **`agents/crime-analyst`** — autonomous agent for safety analysis workflows
- **`commands/crime-report`** — `/crime-report <zip>` slash command

## Installation

### As a Claude Code Plugin

```bash
claude plugin install neighborhood
```

### Local Development

```bash
git clone https://github.com/your-org/neighborhood
cd neighborhood
bun install
```

Test locally against Claude Code:

```bash
claude --plugin-dir /path/to/neighborhood
```

Run the MCP server standalone:

```bash
bun run src/index.ts
```

## Configuration

API keys are optional. Sources with missing keys are skipped gracefully — the plugin works with whatever you have.

| Variable | Purpose | Get a key |
|---|---|---|
| `FBI_API_KEY` | Historical NIBRS crime stats by agency | [api.data.gov/signup](https://api.data.gov/signup) (free) |
| `SPOTCRIME_API_KEY` | Real-time incident reports | [spotcrime.com/police/api](https://spotcrime.com/police/api) |
| `NEWSAPI_KEY` | Additional news coverage beyond RSS feeds | [newsapi.org/register](https://newsapi.org/register) |

Set variables in `~/.config/neighborhood/.env` or export in your shell:

```bash
# ~/.config/neighborhood/.env
FBI_API_KEY=your_key_here
SPOTCRIME_API_KEY=your_key_here
```

## Usage Examples

**Natural language queries:**

```
What's the crime like near 78701?
Generate a crime report for Austin, TX
Compare safety between 78701 and 78704
Show me a map of recent incidents in zip 78701
What types of crimes are trending in this area?
```

**Slash command:**

```
/crime-report 78701
```

**Direct tool invocation** (in Claude conversations):

```
Use get_incidents for zip 78701 and then get_map_html to show me a map
```

## Tech Stack

- TypeScript + Bun
- `@modelcontextprotocol/sdk` for MCP server implementation
- Zod for input validation and schema enforcement
- Leaflet.js for self-contained map output (no external runtime dependency)

## License

MIT
