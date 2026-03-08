# One-Liners

## 1. GitHub Repository Description
MCP server that aggregates live US crime data from 6 sources (SpotCrime, CrimeMapping, ArcGIS, NSOPW, FBI, RSS) by zip code — built as a Claude Code plugin with an autonomous crime-analyst agent and /crime-report command.

## 2. Tweet / Short Social
A Claude Code plugin that pulls live crime data from 6 sources for any US zip code — built by 10 parallel AI agents in 15 minutes. `claude plugin install neightborhood`

## 3. Elevator Pitch (spoken, ~10 seconds)
neightborhood is a Claude Code plugin that lets you ask your AI assistant about crime in any US zip code — it pulls from six live data sources including the FBI, NSOPW, and local police mapping systems, and returns a GeoJSON FeatureCollection, aggregate statistics with trend analysis, a self-contained Leaflet.js map, and RSS news alerts.

## 4. Technical Summary (for developer docs or API directories)
TypeScript MCP server exposing 5 tools (get_incidents, get_crime_stats, get_map_html, get_alerts, list_sources) that query SpotCrime, CrimeMapping.com, ArcGIS, NSOPW, FBI Crime Data Explorer, and News RSS in parallel for any US zip code. Runs on Bun. No required API keys.

## 5. Marketplace / Plugin Directory Listing
Query live crime data for any US zip code from inside Claude. neightborhood hits 6 sources simultaneously — police department incident maps, the national sex offender registry, FBI historical stats, and local news feeds — and returns unified GeoJSON, a self-contained interactive map, aggregate statistics with trend analysis, and news alerts. Includes a /crime-report slash command and an autonomous crime-analyst agent. Zero required API keys to get started.
