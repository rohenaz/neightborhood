---
name: crime-report
description: Generate a comprehensive crime report for any US zip code
argument-hint: "<zip-code>"
allowed-tools:
  - mcp
  - Read
---

Parse the zip code from `$ARGUMENTS`. If no argument was provided, ask the user to supply a zip code before proceeding.

Call these MCP tools in parallel:
- `get_map_html` with the zip code (renders an interactive map inline via MCP Apps)
- `get_crime_stats` with the zip code and a 30-day window
- `get_alerts` with the zip code

Present the results using this structure:

```
## Crime Report: [Zip Code]
**Generated**: [current date and time]
**Radius**: 5 miles | **Period**: Last 30 days

### Summary
- Total incidents: X
- Trend: [increasing / decreasing / stable]
- Top crime types: [ranked list]

### Severity Breakdown
- High (violent crimes): X
- Medium (property crimes): X
- Low (other): X

### Recent Alerts
[Top 5 items from get_alerts, each on its own line with date and headline]

### Data Sources
[For each MCP call, note whether it returned data or failed]
```

Rules:
- The map renders inline automatically via MCP Apps. Do NOT save HTML to files.
- If any source returned `sourceErrors`, name the affected sources explicitly.
- Do not fabricate data. If data is insufficient, say so.
- Keep the report factual and neutral.
