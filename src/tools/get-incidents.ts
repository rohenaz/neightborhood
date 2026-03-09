import { cacheIncidents, getCachedIncidents } from "../cache.ts";
import { zipToCoordinates } from "../geocode.ts";
import { buildFeatureCollection } from "../normalize.ts";
import { fetchArcGIS } from "../sources/arcgis.ts";
import { fetchSocrata } from "../sources/socrata.ts";
import { fetchSpotCrime } from "../sources/spotcrime.ts";
import type {
  IncidentFeatureCollection,
  IncidentSource,
  RawIncident,
  SourceError,
} from "../types.ts";

export interface GetIncidentsInput {
  zipCode: string;
  radius?: number; // miles, default 5
  sources?: IncidentSource[];
  days?: number; // default 30
}

const ALL_SOURCES: IncidentSource[] = ["arcgis", "socrata", "spotcrime"];

export async function getIncidents(
  input: GetIncidentsInput
): Promise<IncidentFeatureCollection> {
  const { zipCode, radius = 5, days = 30 } = input;
  const enabledSources = input.sources ?? ALL_SOURCES;

  const coords = await zipToCoordinates(zipCode);
  const { lat, lng } = coords;

  type SourceFetch = () => Promise<RawIncident[]>;

  const allFetchers: Array<{ source: IncidentSource; fetch: SourceFetch }> = [
    {
      source: "arcgis" as const,
      fetch: () => fetchArcGIS(lat, lng, radius, days, coords.displayName),
    },
    {
      source: "socrata" as const,
      fetch: () => fetchSocrata(lat, lng, radius, days),
    },
    {
      source: "spotcrime" as const,
      fetch: () => fetchSpotCrime(lat, lng, radius, days),
    },
  ];
  const sourceFetchers = allFetchers.filter((f) =>
    enabledSources.includes(f.source)
  );

  const results = await Promise.allSettled(
    sourceFetchers.map(({ fetch }) => fetch())
  );

  const freshIncidents: RawIncident[] = [];
  const sourceErrors: SourceError[] = [];
  const failedSources: IncidentSource[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const fetcher = sourceFetchers[i];
    if (!result || !fetcher) continue;

    if (result.status === "fulfilled") {
      freshIncidents.push(...result.value);
    } else {
      const errorMsg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.error(`[${fetcher.source}] fetch failed: ${errorMsg}`);
      sourceErrors.push({
        source: fetcher.source,
        error: errorMsg,
        timestamp: new Date().toISOString(),
      });
      failedSources.push(fetcher.source);
    }
  }

  // Cache any fresh data we got
  if (freshIncidents.length > 0) {
    try {
      cacheIncidents(zipCode, freshIncidents);
    } catch (e) {
      console.error("[cache] write failed:", e);
    }
  }

  // If some sources failed but we have cached data, backfill from cache
  let allIncidents = freshIncidents;
  if (failedSources.length > 0) {
    try {
      const cached = getCachedIncidents({
        zipCode,
        days: Math.max(days, 90), // look back further in cache for resilience
        sources: failedSources,
      });
      if (cached.length > 0) {
        allIncidents = [...freshIncidents, ...cached];
        // Annotate errors that we served cached data instead
        for (const err of sourceErrors) {
          if (failedSources.includes(err.source as IncidentSource)) {
            err.error += ` (serving ${cached.filter((c) => c.source === err.source).length} cached results)`;
          }
        }
      }
    } catch (e) {
      console.error("[cache] read failed:", e);
    }
  }

  // If ALL sources failed and we got nothing fresh, try full cache
  if (allIncidents.length === 0) {
    try {
      const cached = getCachedIncidents({ zipCode, days: 365 });
      if (cached.length > 0) {
        allIncidents = cached;
        sourceErrors.push({
          source: "cache",
          error: `All live sources failed. Showing ${cached.length} cached results.`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("[cache] fallback read failed:", e);
    }
  }

  // Filter by date range
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const filtered = allIncidents.filter((incident) => {
    try {
      return new Date(incident.date) >= cutoff;
    } catch {
      return true;
    }
  });

  // Deduplicate by incident ID (cache + fresh may overlap)
  const seen = new Set<string>();
  const deduped = filtered.filter((inc) => {
    if (seen.has(inc.id)) return false;
    seen.add(inc.id);
    return true;
  });

  // Cross-source spatial+temporal deduplication
  const final = deduplicateSpatial(deduped);

  return buildFeatureCollection(zipCode, radius, days, final, sourceErrors);
}

function deduplicateSpatial(incidents: RawIncident[]): RawIncident[] {
  const RADIUS_DEG = 100 / 111_000; // ~100m in degrees
  const TIME_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

  // Sort by detail richness — keep the most informative version
  const sorted = [...incidents].sort((a, b) => {
    const scoreA = (a.description?.length || 0) + (a.url ? 100 : 0);
    const scoreB = (b.description?.length || 0) + (b.url ? 100 : 0);
    return scoreB - scoreA;
  });

  const kept: RawIncident[] = [];
  for (const inc of sorted) {
    const isDupe = kept.some(k => {
      if (k.type.toLowerCase() !== inc.type.toLowerCase()) return false;
      const timeDiff = Math.abs(new Date(k.date).getTime() - new Date(inc.date).getTime());
      if (timeDiff > TIME_WINDOW_MS) return false;
      const latDiff = Math.abs(k.lat - inc.lat);
      const lngDiff = Math.abs(k.lng - inc.lng);
      return latDiff < RADIUS_DEG && lngDiff < RADIUS_DEG;
    });
    if (!isDupe) kept.push(inc);
  }
  return kept;
}
