# neightborhood Launch Strategy

## What matters

Two stories, one launch. Lead with whichever fits the platform:

- **Product hook**: "Ask your AI assistant what crimes happened near any US zip code. Get an interactive crime map back." Zero config for most users.
- **Process hook**: "Built a production MCP plugin aggregating 6 live government data sources in ~15 minutes using 10+ parallel Claude Code agents."

The product hook wins on Reddit, HN, and general dev communities. The process hook wins on X/Twitter developer circles, dev.to, and anywhere the "vibe coding" and AI-assisted development conversation is active.

---

## 1. Best Platforms to Announce

### Tier 1

| Platform | Angle | Format | Timing |
|----------|-------|--------|--------|
| X/Twitter | Product demo + process story | 4-tweet thread + map screenshot | Day 1 morning |
| Hacker News | Technical architecture + product | Show HN, 150-300 words | Day 1, 30min after X |
| r/ClaudeAI | Product demo, install CTA | Image post + short description | Day 1, 1hr after HN |
| r/LocalLLaMA | Technical architecture + agents | Text post, technical | Day 1 afternoon |

### Tier 2

| Platform | Angle | Format | Timing |
|----------|-------|--------|--------|
| Discord (Anthropic) | Demo drop, casual | Screenshot + one-liner | Day 1 evening |
| dev.to | Process story (agents build) | Long-form article | Day 3-4 |
| GitHub awesome lists | Reference listing | PR submission | Day 7+ |

---

## 2. Posting Times

- **X/Twitter**: Tuesday-Thursday, 9am-noon ET or 6pm-9pm ET
- **Hacker News**: Tuesday-Thursday, 9am-11am ET
- **Reddit**: Tuesday-Thursday, 8am-10am ET

---

## 3. Hooks That Work

**The demo screenshot is mandatory.** The `get_map_html` dark-themed Leaflet map with color-coded crime pins is the hero asset. Visually distinctive and immediately communicates what the tool does.

**Concreteness beats abstraction.** "Ask Claude: what crimes happened near 48312?" outperforms "query crime data by zip code."

**The contrast hook.** "5 of 6 data sources require zero API keys" is strong differentiation.

**Specific numbers.** "6 data sources" > "multiple data sources". "~15 minutes" > "quickly". "10+ parallel agents" > "several agents".

**The NSOPW angle.** The National Sex Offender Registry integration is a legitimately surprising detail that generates comments and questions.

**GeoJSON output = developer composability.** For technical audiences: "returns a GeoJSON FeatureCollection" signals a composable building block, not a black box.

### What to avoid

- "Excited to share" — never use this phrase
- Vague capability descriptions ("powerful," "comprehensive," "robust")
- Marketing copy voice
- Burying the install command
- Apologizing for limitations in the announcement

---

## 4. Communities and Hashtags

### Hashtags (X/Twitter)

**Primary**: `#MCP`, `#ClaudeCode`, `#ModelContextProtocol`
**Secondary**: `#BuildInPublic`, `#AITools`, `#DevTools`, `#OpenSource`

### Communities

- **Discord**: Anthropic Discord (Claude Code channel), MCP Community
- **Reddit**: r/ClaudeAI, r/LocalLLaMA, r/MachineLearning
- **GitHub**: awesome-mcp-servers repositories (submit PRs)

---

## 5. Recommended Launch Sequence

### Pre-launch (day before)

- [ ] Screenshot the `get_map_html` output rendered in a browser
- [ ] Write the HN Show HN post in a text file
- [ ] Draft the X/Twitter thread (4-6 tweets)
- [ ] Confirm `claude plugin install neightborhood` works end-to-end
- [ ] Ensure README install instructions are clean and tested

### Launch Day (Tuesday or Wednesday, target 9-10am ET)

1. **X/Twitter** (morning) — Publish full thread with map screenshot
2. **Hacker News** (30min later) — Submit Show HN, stay for 2 hours of comments
3. **r/ClaudeAI** (1hr after HN) — Image post, Reddit-hosted screenshot
4. **r/LocalLLaMA** (afternoon) — Technical framing, agents build story
5. **Discord** (evening) — Brief, casual, screenshot-forward
6. **dev.to** (3-4 days later) — Long-form process story with code snippets
7. **awesome-mcp lists** (1 week later) — Submit PRs for long-tail traffic

### Key principle: sequence, don't blast

Post to each platform in sequence with time gaps. Each wave amplifies the previous one.

---

## 6. Sample Posts

### X/Twitter Thread Opener

> Ask Claude: "what crimes happened near 48312 in the last 30 days?"
> Get back an interactive crime map.
>
> neightborhood — a Claude Code plugin aggregating 6 live sources:
> SpotCrime, CrimeMapping, ArcGIS, NSOPW, FBI Crime Data, local news
>
> [screenshot]

### Show HN

> Show HN: neightborhood - MCP plugin aggregating 6 live crime data sources
>
> I built an MCP server that lets Claude query crime data for any US zip code by federating 6 public sources. The server normalizes everything into GeoJSON and can render a self-contained Leaflet.js crime map as HTML (no external runtime, no API keys for 5 of 6 sources).
>
> Sources run via Promise.allSettled so one failure doesn't kill the others. FBI CDE returns annual NIBRS aggregates, synthesized into pseudo-incidents for historical context alongside real-time sources.
>
> Repo: https://github.com/rohenaz/neightborhood

### The Two Headlines

**Product**: "Ask Claude what crimes happened near any US zip code. Get back an interactive map."
**Process**: "Built a production MCP plugin aggregating 6 live crime data APIs in ~15 minutes using parallel Claude Code agents."

Use the product headline everywhere except dev.to, where the process headline is the story.
