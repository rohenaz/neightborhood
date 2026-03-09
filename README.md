<div align="center">

<img src=".github/hero-banner.jpg" alt="neighborhood — Live crime data for AI agents" />

# neighborhood

**Live crime data for AI agents.** 4 sources. 6 tools. Any US location.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

A Claude Code plugin that aggregates live crime data from public sources and exposes it through MCP tools. Accepts US zip codes, state names, state abbreviations, and city names. Returns unified GeoJSON, statistics, interactive maps with comparison views, and news alerts.

## Quick Start

```bash
# Install as a Claude Code plugin
claude plugin install neighborhood
```

Then ask Claude:

```
What's the crime like in Austin, TX?
How safe is Alabama?
Show me crime near 78701
```

Or run the slash command:

```
/crime-report 78701
```

## Location Input

All tools accept flexible location input — not just zip codes:

| Input | Example | Resolution |
|---|---|---|
| ZIP code | `78701` | Direct lookup |
| State abbreviation | `TX` | Capital city area |
| State name | `Texas` | Capital city area |
| City name | `Austin, TX` | Geocoded via Nominatim |

For state-level queries, data is shown for the capital city area. Users can then change the ZIP in the UI to drill into other areas.

## Data Sources

| Source | Data Type | Updates | Auth |
|---|---|---|---|
| ArcGIS Feature Services | Spatial crime incidents (nationwide) | Live | None |
| Socrata Open Data | City/county open data portals | Live | None |
| SpotCrime | Aggregated crime incidents | Live | None |
| FBI Crime Data Explorer | Historical NIBRS aggregate statistics | Annual | Free API key |
| News RSS | Google News + Patch.com local crime news | Live | None |

## MCP Tools

| Tool | Visibility | Description |
|---|---|---|
| `get_incidents` | Model + App | GeoJSON FeatureCollection of crime incidents |
| `get_crime_stats` | Model + App | Aggregated counts by type, severity, and trend |
| `get_alerts` | Model + App | Recent crime news from RSS feeds |
| `get_map_html` | Model + App | Interactive crime map rendered inline via MCP Apps |
| `get_crime_data` | App only | Fetches stats + alerts for the data panel |
| `compare_zips` | App only | Compares crime stats between two ZIP codes |
| `list_sources` | Model + App | Check which data sources are online/offline |

## Interactive Map

The `get_map_html` tool renders an inline interactive map powered by MapLibre GL JS with three tabs:

- **Map** — Clustered crime markers on dark/light themed tiles (Carto by default, Mapbox if `MAPBOX_TOKEN` is set)
- **Data** — Crime statistics, severity breakdown, top crime types, trend analysis, and news alerts
- **Compare** — Side-by-side delta cards comparing crime stats between two ZIP codes

Maps render inline in Claude — no browser required.

## Plugin Components

- **MCP server** — TypeScript, runs via Bun, exposes all tools above
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
git clone https://github.com/rohenaz/neighborhood
cd neighborhood
bun install
```

Test locally:

```bash
claude mcp add neighborhood -- bun run src/index.ts --stdio
```

Or use the plugin directory:

```bash
claude --plugin-dir /path/to/neighborhood
```

### Run the MCP Server

**stdio mode** (Claude Code / Claude Desktop):

```bash
./start.sh
# or directly:
bun run src/index.ts --stdio
```

**HTTP mode** (optional):

```bash
bun run serve
# Starts HTTP server on port 3001
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "neighborhood": {
      "command": "/path/to/neighborhood/start.sh"
    }
  }
}
```

The server declares the `io.modelcontextprotocol/ui` capability for inline map rendering.

## Configuration

`FBI_API_KEY` is optional. Without it, the FBI source is skipped and the other sources still work.

| Variable | Purpose | Get a key |
|---|---|---|
| `FBI_API_KEY` | Historical NIBRS crime stats by agency | [api.data.gov/signup](https://api.data.gov/signup) (free) |
| `MAPBOX_TOKEN` | Mapbox tile style (optional, Carto tiles used by default) | [mapbox.com](https://www.mapbox.com/) |

Set variables in `~/.config/neighborhood/.env` or export in your shell:

```bash
# ~/.config/neighborhood/.env
FBI_API_KEY=your_key_here
```

## Caching

Incidents are cached in SQLite at `~/.config/neighborhood/cache.sqlite` to persist data across restarts and reduce API load during source outages.

## Usage Examples

**Natural language queries:**

```
What's the crime like in Austin, TX?
How safe is Alabama?
Show me a map of recent incidents in 78701
Compare safety between 78701 and 78704
What types of crimes are trending near Denver?
```

**Slash command:**

```
/crime-report 78701
```

**Direct tool invocation:**

```
Use get_incidents for zip 78701 and then get_map_html to show me a map
```

## Tech Stack

- TypeScript + Bun
- Hono (HTTP transport)
- MapLibre GL JS (interactive maps)
- `@modelcontextprotocol/sdk` (MCP server)
- `@modelcontextprotocol/ext-apps` (inline rendering via MCP Apps)
- Vite + `vite-plugin-singlefile` (view bundling)
- Zod (input validation)
- SQLite (incident cache)
- Nominatim (city name geocoding)

## License

MIT
