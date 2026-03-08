# neightborhood Creation Story

## Timeline

**Date**: March 8, 2026
**Total build time**: ~15 minutes from first prompt to published repo
**Method**: Multi-agent parallel development using Claude Code with 10+ specialized agents

## User Prompts (in order)

### 1. Initial Request
> "I live in Sterling Heights, Michigan. I'm looking for live crime data sources in my area. I would like to make an MCP app that feeds this data in a live map view to apps using the MCP app, so it can deliver this to chatbots."

### 2. Scope Expansion
> "I'd like it to work accepting any zip code if you have generic sources, but it's most important that it covers my area well. If it supports many different live sources of data, that would be better."

### 3. Plugin Decision
> "I think we want to make this a Claude Code plugin. publish to new repo rohenaz/neightborhood"

### 4. Delegation Philosophy
> "Please remember: never do anything yourself. Always delegate tasks as often as possible and make sure adequate context and workload are supplied. Always."

### 5. Parallelization Push
> "What can we be doing in parallel?"

## What Was Built

### Data Sources (6)
1. **SpotCrime** — primary incident API with lat/lng
2. **CrimeMapping.com (Axon)** — police department mapped incidents
3. **ArcGIS Feature Services** — Macomb County GIS + SEMCOG
4. **NSOPW** — National Sex Offender Public Registry
5. **FBI Crime Data Explorer** — historical NIBRS aggregate stats
6. **News RSS** — Google News + Patch.com local feeds

### MCP Tools (5)
- `get_incidents` — GeoJSON FeatureCollection from all sources
- `get_crime_stats` — aggregate statistics with trend analysis
- `list_sources` — source health checks
- `get_map_html` — self-contained Leaflet.js interactive map
- `get_alerts` — crime news from RSS

### Plugin Components
- MCP server (TypeScript/Bun, 3,463 lines across 29 files)
- `crime-data` skill — guides Claude on effective tool usage
- `crime-analyst` agent — autonomous neighborhood safety analysis
- `/crime-report` command — instant crime report generation

## Agent Orchestration

The following agents ran in parallel during the build:

| Agent | Role | Duration |
|-------|------|----------|
| Researcher #1 | Crime data API research (Sterling Heights focus) | ~90s |
| Researcher #2 | Broader API research (15 sources evaluated) | ~114s |
| MCP Builder | Core TypeScript server (6 sources, 5 tools, types, cache) | ~504s |
| DevOps | Git init, plugin.json, .mcp.json, GitHub repo creation | ~36s |
| Prompt Engineer #1 | crime-data SKILL.md | ~73s |
| Agent Creator | crime-analyst agent definition | ~73s |
| Prompt Engineer #2 | /crime-report command | ~26s |
| Plugin Validator | Structure, security, naming validation | ~77s |
| Skill Reviewer | Skill quality and trigger effectiveness review | ~46s |
| Documentation Writer | README.md | ~47s |

**Peak parallelism**: 5 agents running simultaneously

## Repo

- **GitHub**: https://github.com/rohenaz/neightborhood
- **Initial commit**: 0b61f0e (29 files, 3,463 insertions)
- **Validation fix commit**: 8839ce3

## Key Stats

- 29 source files
- 6 data sources integrated
- 5 MCP tools exposed
- 0 critical issues found in validation
- Types pass clean (`bunx tsc --noEmit`)
- Works for any US zip code, optimized for Sterling Heights MI (48310-48314)
