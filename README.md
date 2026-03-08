<div align="center">

<img src=".github/hero-banner.jpg" alt="neightborhood — Live crime data for AI agents" width="100%" />

# neightborhood

**Live crime data for AI agents.** 6 sources. 5 tools. Any US zip code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

A Claude Code plugin that aggregates live crime data from six public sources and exposes it through MCP tools. Accepts any US zip code and returns unified GeoJSON, statistics, interactive maps, and news alerts.

Optimized for Sterling Heights, MI (Macomb County) but works nationwide.

## Quick Start

```bash
# Install as a Claude Code plugin
claude plugin install neightborhood
```

Then ask Claude:

```
What's the crime like near 48312?
```

Or run the slash command:

```
/crime-report 48312
```

<div align="center">
<img src="promo/neightborhood-crime-map-demo.gif" alt="neightborhood crime map demo" width="720" />
</div>

## Data Sources

| Source | Data Type | Updates | Auth |
|---|---|---|---|
| SpotCrime | Incident reports with lat/lng | Daily | Optional (demo key included) |
| CrimeMapping.com (Axon) | Mapped incidents from police departments | Live | None |
| ArcGIS Feature Services | Macomb County GIS + SEMCOG spatial data | Live | None |
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
claude plugin install neightborhood
```

### Local Development

```bash
git clone https://github.com/your-org/neightborhood
cd neightborhood
bun install
```

Test locally against Claude Code:

```bash
claude --plugin-dir /path/to/neightborhood
```

Run the MCP server standalone:

```bash
bun run index.ts
```

## Configuration

All environment variables are optional. The plugin runs without any keys using public endpoints and the SpotCrime demo key.

| Variable | Default | Purpose |
|---|---|---|
| `SPOTCRIME_API_KEY` | `thepolice` (demo) | SpotCrime incident reports |
| `FBI_API_KEY` | None | Historical NIBRS stats — get a free key at [api.data.gov/signup](https://api.data.gov/signup) |
| `NEWSAPI_KEY` | None | Additional news coverage beyond Google News and Patch.com |

Set variables in your shell or `.env` file:

```bash
export FBI_API_KEY=your_key_here
export SPOTCRIME_API_KEY=your_key_here
```

## Usage Examples

**Natural language queries:**

```
What's the crime like near 48312?
Generate a crime report for Sterling Heights
Compare safety between 48312 and 90210
Show me a map of recent incidents in zip 48312
What types of crimes are trending in this area?
```

**Slash command:**

```
/crime-report 48312
```

**Direct tool invocation** (in Claude conversations):

```
Use get_incidents for zip 48312 and then get_map_html to show me a map
```

## Tech Stack

- TypeScript + Bun
- `@modelcontextprotocol/sdk` for MCP server implementation
- Zod for input validation and schema enforcement
- Leaflet.js for self-contained map output (no external runtime dependency)

## License

MIT
