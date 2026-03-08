# Demo Script — neighborhood

A step-by-step walkthrough for live demos, screencasts, or written tutorials. Each section shows what to type and what to expect in return.

---

## Prerequisites

- Claude Code installed (`claude --version` should return a version)
- Internet connection
- No API keys required for the basic demo

---

## Step 1: Install the Plugin

```bash
claude plugin install neighborhood
```

**Expected output:**
```
Installing neighborhood...
Plugin installed successfully.
```

The plugin registers the MCP server, the crime-data skill, the crime-analyst agent, and the /crime-report command all at once. No configuration needed.

---

## Step 2: Open a Claude Code Session

```bash
claude
```

You are now in an interactive Claude Code session with the neighborhood MCP tools available in context.

---

## Step 3: Natural Language Query (Simplest Entry Point)

**Type:**
```
What's the crime like near 48312?
```

**What happens internally:**
Claude reads the crime-data skill, determines which tools to call, invokes `get_incidents` and `get_crime_stats` for zip 48312, receives GeoJSON and aggregate statistics from SpotCrime, CrimeMapping, ArcGIS, NSOPW, the FBI, and News RSS, then synthesizes a plain-language summary.

**Expected response (paraphrased):**
Claude will return a narrative summary covering incident types and counts for the area, the most common crime categories, any notable trends from the statistical data, and an offer to generate an interactive map or pull recent news alerts.

---

## Step 4: Generate an Interactive Map

**Type:**
```
Show me a map of recent incidents in 48312
```

**What happens:**
Claude calls `get_map_html` for zip 48312 and returns a self-contained HTML string with a Leaflet.js map embedded. All JavaScript and CSS is inlined — no external CDN calls at runtime.

**To view the map, save it to a file:**
```
Save the map HTML to /tmp/crime-map.html
```

Then open it:
```bash
open /tmp/crime-map.html
```

**Expected result:** A browser tab opens showing a map centered on the zip code with colored pins for each crime incident. Clicking a pin shows the incident type, date, and source.

---

## Step 5: Use the Slash Command

The `/crime-report` command generates a full structured report in one step.

**Type:**
```
/crime-report 48312
```

**Expected output structure:**
```
Crime Report: 48312 (Sterling Heights, MI)
Generated: [timestamp]

SUMMARY
- Total incidents (last 30 days): [N]
- Most common type: [category]
- Trend vs prior period: [up/down/flat] [%]

INCIDENTS BY TYPE
- Theft: [N]
- Vandalism: [N]
- Assault: [N]
[...]

SEX OFFENDER REGISTRY
- Registered offenders in zip: [N]

RECENT NEWS
- [headline] — [source] — [date]
- [headline] — [source] — [date]

DATA SOURCES
- SpotCrime: [status]
- CrimeMapping: [status]
- ArcGIS: [status]
- NSOPW: [status]
- FBI CDE: [status]
- News RSS: [status]
```

---

## Step 6: Compare Two Areas

**Type:**
```
Compare crime between zip codes 48312 and 90210
```

**What happens:**
Claude calls `get_crime_stats` for both zip codes in parallel, receives aggregate data for each, and returns a side-by-side comparison covering total incident counts, crime type breakdowns, and any available trend data.

This is a good demo moment to show that the plugin works for any US zip code, not just Southeast Michigan.

---

## Step 7: Check Source Health

**Type:**
```
Which crime data sources are currently online?
```

**What happens:**
Claude calls `list_sources`, which pings each of the 6 data sources and returns their current status.

**Expected output:**
```
Data Source Status:
- SpotCrime: online
- CrimeMapping.com: online
- ArcGIS (Macomb County): online
- NSOPW: online
- FBI Crime Data Explorer: online (historical data only)
- News RSS: online
```

If a source is offline, the other five continue to function. The plugin degrades gracefully per source.

---

## Step 8: Run the Crime Analyst Agent (Advanced)

The `crime-analyst` agent is an autonomous agent designed for deeper analysis workflows.

**Type:**
```
Run a full neighborhood safety analysis for 48312 and tell me whether the area has gotten safer or more dangerous over the past year
```

**What the agent does:**
It calls `get_crime_stats` to retrieve current period data, pulls FBI historical stats for the longer time horizon, calls `get_alerts` for recent news context, and synthesizes a structured analysis with trend reasoning and data caveats.

This is the "agent-for-agents" use case: a specialized sub-agent handling a multi-step research workflow that would require 4-5 tool calls and synthesis logic if done manually.

---

## Optional: Add API Keys for More Data

All API keys are optional. The plugin runs on public endpoints and a bundled SpotCrime demo key by default. To unlock additional coverage:

```bash
export FBI_API_KEY=your_key_here        # Free at api.data.gov/signup
export SPOTCRIME_API_KEY=your_key_here  # From spotcrime.com
export NEWSAPI_KEY=your_key_here        # From newsapi.org
```

The FBI key is the most useful addition — it unlocks the full NIBRS historical statistics database, which enables multi-year trend comparisons.

---

## Uninstall

```bash
claude plugin uninstall neighborhood
```

---

## Troubleshooting

**"Plugin not found" on install:**
Make sure you are running a recent version of Claude Code. Run `claude --version` and update if needed.

**Source returns no data for a zip code:**
Not all sources cover all zip codes equally. CrimeMapping.com depends on whether the local police department has an Axon integration. ArcGIS layers are optimized for Macomb County. SpotCrime and the FBI cover most US metro areas. Run `list_sources` to see what's available.

**Map HTML is empty or shows no pins:**
This usually means `get_incidents` returned zero results for that zip code. Try a larger metro area zip code like 48312 (Sterling Heights) or 10001 (Manhattan) to confirm the tool is working.

---

## Repo

https://github.com/rohenaz/neighborhood
