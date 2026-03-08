---
name: crime-data
description: This skill should be used when a user asks about crime data, crime maps, neighborhood safety, crime reports, incident data, crime statistics, sex offenders, local crime, safety of an area, "is this zip code safe", "what crimes happened near me", crime trends, or safety assessments for any U.S. zip code. It queries live crime incidents, statistics, alerts, and interactive maps using the neightborhood MCP tools.
---

# Crime Data

Use the neightborhood MCP server to query, interpret, and present crime data for U.S. zip codes.

## Available Tools

| Tool | Purpose | Key Inputs |
|------|---------|------------|
| `get_incidents` | Raw incident points as GeoJSON | zipCode, radius (mi), sources, days |
| `get_crime_stats` | Aggregated counts, severity, trends | zipCode, days |
| `get_alerts` | Recent news and RSS crime alerts | zipCode, keywords |
| `get_map_html` | Self-contained Leaflet.js HTML map | zipCode, radius, days |
| `list_sources` | Status of all 6 data sources | none |

## Source Reference

The MCP server aggregates from six sources. Understand their strengths:

| Source | Best For | Latency Notes |
|--------|---------|---------------|
| SpotCrime | Recent local incidents, broad coverage | Fast |
| CrimeMapping | Precise police-reported incidents | Fast |
| ArcGIS | Official city/county GIS data | Medium |
| NSOPW | Sex offender registry lookups | Fast |
| FBI | Annual crime statistics | Slow; historical only — skip for "recent" queries |
| News RSS | Breaking crime news and alerts | Fast |

## Choosing Sources

Do not blindly query all sources for every task. Match sources to intent:

- **User asks about recent crime**: Use SpotCrime, CrimeMapping, ArcGIS. Skip FBI (annual data only).
- **User asks about sex offenders**: Include NSOPW. It is the only source for registry data.
- **User wants a crime map**: Use `get_map_html`. SpotCrime and CrimeMapping produce the most useful pins.
- **User wants news or alerts**: Use `get_alerts` or include News RSS in `get_incidents`.
- **User wants trends over time**: Use `get_crime_stats` with a longer `days` window (90–365).
- **User wants a comprehensive safety report**: Combine `get_crime_stats` + `get_incidents` + `get_alerts`.

Pass the `sources` array explicitly when you want to restrict which sources are queried. Omit it to query all available sources.

## Interpreting GeoJSON Results

`get_incidents` returns a GeoJSON FeatureCollection. Each feature has:

```json
{
  "type": "Feature",
  "geometry": { "type": "Point", "coordinates": [longitude, latitude] },
  "properties": {
    "id": "...",
    "type": "Theft",
    "description": "...",
    "date": "2026-03-01T14:00:00Z",
    "address": "...",
    "source": "SpotCrime",
    "severity": "medium",
    "url": "..."
  }
}
```

When summarizing GeoJSON results:
- Count total features and group by `properties.type`.
- Group by `properties.severity` to give a high/medium/low breakdown.
- Sort incidents by date descending when presenting a list to users.
- Do not dump raw GeoJSON at the user. Translate it into prose or a structured table.
- If coordinates are present, note geographic clustering when it is significant (e.g., "Most incidents cluster near the downtown core").

## Severity Classification

Use these categories consistently:

| Severity | Crime Types |
|----------|------------|
| high | Homicide, assault, robbery, rape, shooting, carjacking, kidnapping |
| medium | Burglary, theft, auto theft, vandalism, arson, fraud |
| low | News items, RSS alerts, sex offender registry entries, unclassified reports |

The `severity` field in each feature reflects what the source reported. When the field is missing or ambiguous, classify it yourself using the table above based on the `type` field.

## Interpreting `get_crime_stats`

`get_crime_stats` returns aggregated data including:
- `countByType`: object mapping crime type to incident count
- `severityBreakdown`: `{ high, medium, low }` counts
- `trend`: string — `"increasing"`, `"decreasing"`, or `"stable"`
- `totalIncidents`: integer

When presenting stats:
- Lead with total incidents and the trend direction.
- Highlight the top 3 crime types by count.
- State the severity breakdown clearly: "X serious (high-severity), Y property (medium), Z other (low)."
- If `trend` is `"increasing"`, note the timeframe queried (`days` parameter).

## Handling `sourceErrors`

Both `get_incidents` and `get_crime_stats` responses include a `sourceErrors` field — an object mapping source names to error messages for any source that failed during the query.

Always check `sourceErrors`. If it is non-empty:
- Inform the user which sources failed and that their data is excluded from results.
- Example: "Note: CrimeMapping and NSOPW were unavailable during this query. Results reflect SpotCrime, ArcGIS, FBI, and News RSS only."
- Do not silently omit this. Missing sources can significantly undercount incidents.

If all sources fail for a zip code, do not present empty results as "no crime found." Inform the user that data retrieval failed entirely.

## Presenting the Crime Map

`get_map_html` returns a self-contained HTML string with an embedded Leaflet.js map. Color-coded pins represent crime types.

To deliver the map to a user:
1. Save the HTML string to a file with a `.html` extension (e.g., `crime-map-10001.html`).
2. Tell the user the file path and instruct them to open it in any web browser.
3. Mention that pins are color-coded by crime type and clickable for incident details.
4. Do not attempt to render the HTML inline in the chat — it is a standalone file.

If the user is in a web context and can accept HTML, you may offer the raw HTML string directly. In a terminal/CLI context, always write it to a file.

## Presenting Alerts

`get_alerts` returns recent news items from RSS feeds. Each alert has:
- `title`: headline
- `date`: publication date
- `source`: feed name
- `url`: link to full article
- `description`: excerpt

Present alerts as a bullet list with date, headline, and link. Group by recency (last 7 days, last 30 days). Omit alerts older than the `days` parameter used in the query.

## Comprehensive Safety Report Workflow

When a user asks for a full neighborhood safety assessment, run these tools in sequence:

1. `list_sources` — Check which sources are online. Note any offline sources upfront.
2. `get_crime_stats` with `days: 30` — Get the aggregate picture.
3. `get_incidents` with `days: 30`, filtered to SpotCrime + CrimeMapping + ArcGIS — Get incident-level detail.
4. `get_alerts` — Get recent news context.
5. `get_map_html` — Generate a map file for the user.

Structure the report as:

```
## Safety Overview: [Zip Code] ([Radius]-mile radius, last 30 days)

**Summary**: [1-2 sentence lead with total incidents and trend]

**Severity Breakdown**: X high / Y medium / Z low

**Top Crime Types**:
- [Type]: [count]
- [Type]: [count]
- [Type]: [count]

**Notable Recent Incidents**: [3-5 most recent high/medium incidents with date, type, address]

**Recent Alerts**: [2-3 news items with date and link]

**Interactive Map**: Saved to [filename]. Open in any browser.

**Data Sources**: [list sources used] | [list any failed sources]
```

Adjust the report structure if the user asks for something more specific (e.g., "just show me violent crime" or "only property crime from last week").

## Common Queries and Approaches

**"Is [neighborhood/zip] safe?"**
Run the full safety report workflow. Qualify the answer: crime statistics show reported incidents, not actual safety perception. Compare to national averages only if the user asks.

**"Show me a crime map for [zip]"**
Call `get_map_html`. Save to file. Present the file path and brief stats from `get_crime_stats`.

**"What crimes happened near me recently?"**
Call `get_incidents` with `days: 7` or `days: 14`. Summarize the top incident types and most recent events.

**"Are there sex offenders in [zip]?"**
Call `get_incidents` with `sources: ["NSOPW"]`. Summarize registry entry count. Do not list individual names or personal details unless the source explicitly provides public registry data.

**"How has crime changed over time?"**
Call `get_crime_stats` twice: once with `days: 30` and once with `days: 90` or `days: 365`. Compare totals and note the `trend` field.

**"What crimes are most common?"**
Call `get_crime_stats`. Present `countByType` sorted descending. Focus on the top 5 types.

## Error Handling

- If a zip code returns zero incidents across all sources, check `sourceErrors` first. If sources failed, report the failure. If sources succeeded with zero results, state that no incidents were reported for that area in the time range.
- If `list_sources` shows more than 2 sources offline, warn the user that results may be significantly incomplete before proceeding.
- If the MCP server itself is unavailable, inform the user that the neightborhood crime data service is unreachable and suggest they try again later.

## Parameter Defaults

When users do not specify parameters, use these defaults:
- `radius`: 5 miles (increase to 10 for rural zip codes with sparse data)
- `days`: 30
- `sources`: all available (do not restrict unless the use case calls for it)

If a query returns fewer than 5 incidents with default parameters, offer to expand the radius or time window before concluding there is little crime data for the area.
