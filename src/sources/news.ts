import type { NewsAlert } from "../types.ts";

// RSS-based crime news aggregation
// Sources: Google News RSS, Patch local news

const GOOGLE_NEWS_RSS = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

// Patch.com feeds for Austin, TX / Travis County area
const PATCH_FEEDS = [
  "https://patch.com/texas/downtownaustin/local-news/rss.xml",
  "https://patch.com/texas/eastaustin/local-news/rss.xml",
  "https://patch.com/texas/roundrock/local-news/rss.xml",
  "https://patch.com/texas/cedarpark/local-news/rss.xml",
];

interface RSSItem {
  title: string;
  link: string;
  pubDate: string;
  description: string;
  source?: string;
}

function parseRSSItems(xml: string, defaultSource: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Simple XML regex parsing — avoids DOM parser dependency
  const itemRegex = /<item[^>]*>([\s\S]*?)<\/item>/g;
  const matches = xml.matchAll(itemRegex);

  for (const match of matches) {
    const itemXml = match[1] ?? "";

    const title = extractTag(itemXml, "title");
    const link =
      extractTag(itemXml, "link") || extractAttr(itemXml, "link", "href");
    const pubDate =
      extractTag(itemXml, "pubDate") || extractTag(itemXml, "published");
    const description =
      extractTag(itemXml, "description") ||
      extractTag(itemXml, "content:encoded") ||
      extractTag(itemXml, "summary");
    const sourceName =
      extractTag(itemXml, "source") ||
      extractAttr(itemXml, "source", "url") ||
      defaultSource;

    if (title && link) {
      items.push({
        title: stripHtml(title),
        link: stripHtml(link).trim(),
        pubDate: pubDate ? stripHtml(pubDate).trim() : new Date().toISOString(),
        description: stripHtml(description).slice(0, 500),
        source: stripHtml(sourceName).trim() || defaultSource,
      });
    }
  }

  return items;
}

function extractTag(xml: string, tag: string): string {
  const patterns = [
    new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, "i"),
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"),
  ];
  for (const regex of patterns) {
    const m = regex.exec(xml);
    if (m?.[1]) return m[1].trim();
  }
  return "";
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const regex = new RegExp(`<${tag}[^>]*${attr}=["']([^"']+)["']`, "i");
  const m = regex.exec(xml);
  return m?.[1] ?? "";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCrimeRelated(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  const defaultKeywords = [
    "crime",
    "criminal",
    "arrest",
    "police",
    "stolen",
    "robbery",
    "burglary",
    "assault",
    "shooting",
    "murder",
    "homicide",
    "theft",
    "fraud",
    "drugs",
    "warrant",
    "suspect",
    "victim",
    "investigation",
    "charged",
    "convicted",
    "sentenced",
    "crash",
    "DUI",
    "hit-and-run",
  ];
  const allKeywords = keywords.length ? keywords : defaultKeywords;
  return allKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

async function fetchFeed(url: string, sourceName: string): Promise<RSSItem[]> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml, */*",
      "User-Agent": "neighborhood-mcp/1.0 (crime-data-aggregator)",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `RSS fetch failed for ${sourceName}: HTTP ${response.status}`
    );
  }

  const xml = await response.text();
  return parseRSSItems(xml, sourceName);
}

export async function fetchNewsAlerts(
  zipCode: string,
  keywords: string[] = []
): Promise<NewsAlert[]> {
  const queries = [
    `${zipCode} crime`,
    `Austin Texas crime`,
    `Travis County Texas crime`,
  ];

  const feedUrls: Array<{ url: string; source: string }> = [
    ...queries.map((q) => ({ url: GOOGLE_NEWS_RSS(q), source: "Google News" })),
    ...PATCH_FEEDS.map((url) => ({ url, source: "Patch.com" })),
  ];

  const results = await Promise.allSettled(
    feedUrls.map(({ url, source }) => fetchFeed(url, source))
  );

  const allItems: RSSItem[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      allItems.push(...result.value);
    }
    // Failed feeds are silently skipped at this level — caller handles errors
  }

  // De-duplicate by link
  const seen = new Set<string>();
  const unique = allItems.filter((item) => {
    if (seen.has(item.link)) return false;
    seen.add(item.link);
    return true;
  });

  // Filter to crime-related content
  const crimeItems = unique.filter((item) =>
    isCrimeRelated(`${item.title} ${item.description}`, keywords)
  );

  // Sort by recency
  crimeItems.sort((a, b) => {
    const da = new Date(a.pubDate).getTime();
    const db = new Date(b.pubDate).getTime();
    return db - da;
  });

  return crimeItems.map(
    (item): NewsAlert => ({
      title: item.title,
      url: item.link,
      publishedAt: new Date(item.pubDate).toISOString(),
      source: item.source ?? "Unknown",
      description: item.description,
      snippet: item.description.slice(0, 200),
    })
  );
}

// For use in get_incidents — returns RawIncident-compatible stub for news items
// News items don't have precise coordinates so they're given the zip centroid
import type { RawIncident } from "../types.ts";

export async function fetchNewsAsIncidents(
  zipCode: string,
  lat: number,
  lng: number
): Promise<RawIncident[]> {
  const alerts = await fetchNewsAlerts(zipCode, []);

  return alerts.slice(0, 20).map(
    (alert, idx): RawIncident => ({
      source: "news",
      id: `news-${zipCode}-${idx}`,
      type: "News Alert",
      description: alert.title,
      date: alert.publishedAt,
      address: `${zipCode} area`,
      lat,
      lng,
      url: alert.url,
      severity: "low",
    })
  );
}
