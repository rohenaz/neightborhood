# Twitter/X Thread

---

**Tweet 1**

A user in Sterling Heights, MI asked Claude Code for live crime data for their neighborhood.

15 minutes later: a published Claude Code plugin pulling from 6 live sources, with an interactive map, a slash command, and an autonomous crime-analyst agent.

Here's how it happened.

---

**Tweet 2**

The user typed 4 prompts total. The last two were:

"Never do anything yourself. Always delegate as often as possible."

"What can we be doing in parallel?"

That was the entire direction. Claude Code took it from there.

---

**Tweet 3**

10 specialized agents ran in parallel:

- 2 researchers evaluating 15+ crime APIs simultaneously
- 1 MCP builder constructing the TypeScript server
- 1 DevOps agent initializing git, writing plugin.json, creating the GitHub repo
- 4 prompt engineers writing the skill, agent definition, slash command, and README
- 1 validator running a full security and structure review

Peak: 5 agents running at the same time.

---

**Tweet 4**

What shipped:

- `get_incidents` — GeoJSON from SpotCrime, CrimeMapping, ArcGIS, NSOPW
- `get_crime_stats` — aggregate counts with trend analysis
- `get_map_html` — self-contained Leaflet.js map, no external deps
- `get_alerts` — live RSS crime news
- `/crime-report <zip>` slash command
- `crime-analyst` autonomous agent

29 files, 3,463 lines. Zero critical issues on first validation pass.

---

**Tweet 5**

Install it now:

```
claude plugin install neightborhood
```

Then ask Claude: "What's the crime like near 48312?"

Works for any US zip code. No required API keys — runs on public endpoints out of the box.

MIT licensed: https://github.com/rohenaz/neightborhood

---

**Tweet 6**

A working, validated, published developer tool went from "I have an idea" to `claude plugin install` in the time it takes to make lunch.

Multi-agent parallel development produces real software. This is what that looks like at full speed.

---

**Tweet 7**

"neightborhood" — portmanteau of neigh + neighborhood.

The name was also generated in the session.

Built by agents and consumed by agents.

https://github.com/rohenaz/neightborhood
