import { TTLCache } from "../cache.ts";

export interface ScannerFeed {
  id: string;
  name: string;
  county: string;
  listeners?: number;
  status?: "online" | "offline";
  url: string;
}

const USER_AGENT = "neighborhood-mcp/1.0 (scanner-feed-discovery)";

// Cache county ID lookups for 24 hours
const countyIdCache = new TTLCache<number>(86400);
// Cache feed results for 15 minutes
const feedCache = new TTLCache<ScannerFeed[]>(900);

const STATE_FIPS: Record<string, number> = {
  Alabama: 1,
  Alaska: 2,
  Arizona: 4,
  Arkansas: 5,
  California: 6,
  Colorado: 8,
  Connecticut: 9,
  Delaware: 10,
  Florida: 12,
  Georgia: 13,
  Hawaii: 15,
  Idaho: 16,
  Illinois: 17,
  Indiana: 18,
  Iowa: 19,
  Kansas: 20,
  Kentucky: 21,
  Louisiana: 22,
  Maine: 23,
  Maryland: 24,
  Massachusetts: 25,
  Michigan: 26,
  Minnesota: 27,
  Mississippi: 28,
  Missouri: 29,
  Montana: 30,
  Nebraska: 31,
  Nevada: 32,
  "New Hampshire": 33,
  "New Jersey": 34,
  "New Mexico": 35,
  "New York": 36,
  "North Carolina": 37,
  "North Dakota": 38,
  Ohio: 39,
  Oklahoma: 40,
  Oregon: 41,
  Pennsylvania: 42,
  "Rhode Island": 44,
  "South Carolina": 45,
  "South Dakota": 46,
  Tennessee: 47,
  Texas: 48,
  Utah: 49,
  Vermont: 50,
  Virginia: 51,
  Washington: 53,
  "West Virginia": 54,
  Wisconsin: 55,
  Wyoming: 56,
  "District of Columbia": 11,
};

/**
 * Parse county name and state name from Nominatim displayName.
 * Nominatim returns strings like "48313, Macomb County, Michigan, United States"
 */
function parseLocation(
  displayName: string
): { county: string; state: string } | null {
  const parts = displayName.split(",").map((p) => p.trim());
  // Typical format: "ZIP, County [County], State, United States"
  // Find state by matching against known FIPS keys
  for (let i = 1; i < parts.length; i++) {
    const candidate = parts[i];
    if (candidate && STATE_FIPS[candidate] !== undefined) {
      // The part before this is likely the county
      const countyPart = parts[i - 1];
      if (countyPart) {
        // Strip "County" suffix for matching against Broadcastify
        const county = countyPart.replace(/\s+County$/i, "").trim();
        return { county, state: candidate };
      }
    }
  }
  return null;
}

/**
 * Scrape the Broadcastify state page to find the county ID for a given county name.
 */
async function findCountyId(
  stateFips: number,
  countyName: string
): Promise<number | null> {
  const cacheKey = `${stateFips}:${countyName}`;
  const cached = countyIdCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const url = `https://www.broadcastify.com/listen/stid/${stateFips}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Broadcastify state page returned HTTP ${resp.status}`);
  }

  const html = await resp.text();

  // County links look like: <a href="/listen/ctid/1234">County Name</a>
  const countyPattern = /<a\s+href="\/listen\/ctid\/(\d+)"[^>]*>([^<]+)<\/a>/gi;
  const lowerCounty = countyName.toLowerCase();
  const countyMatches = [...html.matchAll(countyPattern)];

  // Exact match first
  for (const match of countyMatches) {
    const ctid = Number.parseInt(match[1], 10);
    const name = match[2].trim();

    if (
      name
        .toLowerCase()
        .replace(/\s+county$/i, "")
        .trim() === lowerCounty
    ) {
      countyIdCache.set(cacheKey, ctid);
      return ctid;
    }
  }

  // Fuzzy match: check if county name is contained
  for (const match of countyMatches) {
    const ctid = Number.parseInt(match[1], 10);
    const name = match[2].trim().toLowerCase();

    if (
      name.includes(lowerCounty) ||
      lowerCounty.includes(name.replace(/\s+county$/i, "").trim())
    ) {
      countyIdCache.set(cacheKey, ctid);
      return ctid;
    }
  }

  return null;
}

/**
 * Scrape the county public safety page for scanner feeds.
 */
async function scrapeCountyFeeds(
  countyId: number,
  countyName: string
): Promise<ScannerFeed[]> {
  const url = `https://www.broadcastify.com/listen/ctid/${countyId}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10000),
  });

  if (!resp.ok) {
    throw new Error(`Broadcastify county page returned HTTP ${resp.status}`);
  }

  const html = await resp.text();
  const feeds: ScannerFeed[] = [];

  // Feed links: <a href="/listen/feed/38639">...<span class="px13">Feed Name</span>...</a>
  // Sometimes the structure varies, so look for feed IDs and nearby text
  const feedPattern =
    /<a\s+href="\/listen\/feed\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(feedPattern)) {
    const feedId = match[1];
    const inner = match[2];

    // Try to extract name from <span class="px13"> or just use inner text
    const spanMatch = inner.match(
      /<span[^>]*class="[^"]*px13[^"]*"[^>]*>([^<]+)<\/span>/i
    );
    let name = spanMatch
      ? spanMatch[1].trim()
      : inner.replace(/<[^>]+>/g, "").trim();

    if (!name || !feedId) continue;

    // Strip trailing listener counts like "(1,441)" from feed names
    const listenerInName = name.match(/\s*\(([0-9,]+)\)\s*$/);
    let inlineListeners: number | undefined;
    if (listenerInName) {
      inlineListeners = Number.parseInt(
        listenerInName[1].replace(/,/g, ""),
        10
      );
      name = name.replace(/\s*\([0-9,]+\)\s*$/, "").trim();
    }

    // Also strip leading/trailing ellipsis artifacts
    name = name
      .replace(/^\.{3}\s*/, "")
      .replace(/\s*\.{3}$/, "")
      .trim();

    // Deduplicate by feed ID
    if (feeds.some((f) => f.id === feedId)) continue;

    feeds.push({
      id: feedId,
      name,
      county: countyName,
      listeners: inlineListeners,
      url: `https://www.broadcastify.com/listen/feed/${feedId}`,
    });
  }

  return feeds;
}

/**
 * Check feed status and listener count from Broadcastify.
 * Uses a short timeout since this is optional enrichment.
 */
async function checkFeedStatus(feed: ScannerFeed): Promise<ScannerFeed> {
  try {
    const resp = await fetch(feed.url, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return { ...feed, status: "offline" };

    const html = await resp.text();

    // Look for listener count — typically in the page as "X Listeners" or similar
    const listenerMatch = html.match(/(\d+)\s*Listener/i);
    const listeners = listenerMatch
      ? Number.parseInt(listenerMatch[1], 10)
      : feed.listeners; // preserve inline count from county page

    // Check if feed is marked as offline
    const isOffline =
      html.includes("Currently Offline") || html.includes("Feed Offline");
    const status: "online" | "offline" = isOffline ? "offline" : "online";

    return { ...feed, listeners, status };
  } catch {
    return { ...feed, status: "offline" };
  }
}

/**
 * Discover police scanner feeds for a location.
 * @param zipCode - The ZIP code being queried
 * @param lat - Latitude (unused currently, reserved for future proximity sorting)
 * @param lng - Longitude (unused currently, reserved for future proximity sorting)
 * @param displayName - Nominatim display_name string for location parsing
 */
export async function discoverScannerFeeds(
  zipCode: string,
  _lat: number,
  _lng: number,
  displayName: string
): Promise<ScannerFeed[]> {
  const cacheKey = `scanner:${zipCode}`;
  const cached = feedCache.get(cacheKey);
  if (cached) return cached;

  const location = parseLocation(displayName);
  if (!location) return [];

  const stateFips = STATE_FIPS[location.state];
  if (stateFips === undefined) return [];

  const countyId = await findCountyId(stateFips, location.county);
  if (!countyId) return [];

  const feeds = await scrapeCountyFeeds(countyId, location.county);
  if (feeds.length === 0) {
    feedCache.set(cacheKey, []);
    return [];
  }

  // Check status for all feeds in parallel (with short timeouts)
  const enriched = await Promise.all(feeds.map(checkFeedStatus));

  // Sort: online first, then by listener count descending
  enriched.sort((a, b) => {
    if (a.status === "online" && b.status !== "online") return -1;
    if (a.status !== "online" && b.status === "online") return 1;
    return (b.listeners ?? 0) - (a.listeners ?? 0);
  });

  feedCache.set(cacheKey, enriched);
  return enriched;
}
