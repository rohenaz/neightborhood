import { cacheIncidents, getCachedIncidents } from "../cache.ts";
import { zipToCoordinates } from "../geocode.ts";
import { classifySeverity } from "../normalize.ts";
import { fetchArcGIS } from "../sources/arcgis.ts";
import { fetchFBIStats } from "../sources/fbi.ts";
import { fetchSocrata } from "../sources/socrata.ts";
import { fetchSpotCrime } from "../sources/spotcrime.ts";
import type {
  CrimeStats,
  IncidentSeverity,
  RawIncident,
  SourceError,
} from "../types.ts";

export interface GetCrimeStatsInput {
  zipCode: string;
  days?: number; // default 30
}

export async function getCrimeStats(
  input: GetCrimeStatsInput
): Promise<CrimeStats> {
  const { zipCode, days = 30 } = input;
  const coords = await zipToCoordinates(zipCode);
  const { lat, lng } = coords;

  const sourceErrors: SourceError[] = [];
  const allIncidents: RawIncident[] = [];

  // Gather incidents from crime data sources only — news is shown in the News tab
  const radius = 10;
  const fetchers = [
    {
      source: "arcgis",
      fetch: () => fetchArcGIS(lat, lng, radius, days, coords.displayName),
    },
    {
      source: "socrata",
      fetch: () => fetchSocrata(lat, lng, radius, days),
    },
    {
      source: "spotcrime",
      fetch: () => fetchSpotCrime(lat, lng, radius, days),
    },
  ];

  const incidentResults = await Promise.allSettled(
    fetchers.map(({ fetch }) => fetch())
  );

  for (let i = 0; i < incidentResults.length; i++) {
    const result = incidentResults[i];
    const fetcher = fetchers[i];
    if (!result || !fetcher) continue;

    if (result.status === "fulfilled") {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      allIncidents.push(
        ...result.value.filter((inc) => {
          try {
            return new Date(inc.date) >= cutoff;
          } catch {
            return true;
          }
        })
      );
    } else {
      const msg =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      sourceErrors.push({
        source: fetcher.source,
        error: msg,
        timestamp: new Date().toISOString(),
      });
    }
  }

  // Cache fresh incidents
  if (allIncidents.length > 0) {
    try {
      cacheIncidents(zipCode, allIncidents);
    } catch (e) {
      console.error("[cache] write failed:", e);
    }
  }

  // If we got nothing fresh, pull from cache
  if (allIncidents.length === 0) {
    try {
      const cached = getCachedIncidents({ zipCode, days: Math.max(days, 90) });
      if (cached.length > 0) {
        allIncidents.push(...cached);
        sourceErrors.push({
          source: "cache",
          error: `Live sources returned no data. Showing ${cached.length} cached results.`,
          timestamp: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.error("[cache] read failed:", e);
    }
  }

  // FBI historical stats
  let fbiStats: Awaited<ReturnType<typeof fetchFBIStats>> = [];
  try {
    fbiStats = await fetchFBIStats(lat, lng, 10);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[fbi] stats fetch failed: ${msg}`);
    sourceErrors.push({
      source: "fbi",
      error: msg,
      timestamp: new Date().toISOString(),
    });
  }

  // Aggregate recent incident stats
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const bySeverity: Record<IncidentSeverity, number> = {
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const incident of allIncidents) {
    byType[incident.type] = (byType[incident.type] ?? 0) + 1;
    bySource[incident.source] = (bySource[incident.source] ?? 0) + 1;
    const sev = incident.severity ?? classifySeverity(incident.type);
    bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
  }

  // Add FBI historical type counts
  for (const agency of fbiStats) {
    bySource[`fbi-${agency.ori}`] = agency.offenses.reduce(
      (sum, o) => sum + o.count,
      0
    );
    for (const offense of agency.offenses) {
      byType[offense.type] = (byType[offense.type] ?? 0) + offense.count;
    }
  }

  const totalIncidents = allIncidents.length;

  // Top types sorted by count
  const topTypes = Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 25)
    .map(([type, count]) => ({
      type,
      count,
      percentage:
        totalIncidents > 0
          ? Math.round((count / totalIncidents) * 100 * 10) / 10
          : 0,
    }));

  // Trend: compare first half vs second half of the time window
  const trend = computeTrend(allIncidents, days);

  return {
    zipCode,
    days,
    totalIncidents,
    byType,
    bySource,
    bySeverity,
    topTypes,
    trend,
    generatedAt: new Date().toISOString(),
    sourceErrors,
  };
}

function computeTrend(
  incidents: RawIncident[],
  days: number
): CrimeStats["trend"] {
  if (incidents.length < 4) return "unknown";

  const now = Date.now();
  const halfMs = (days / 2) * 24 * 60 * 60 * 1000;
  const midpoint = now - halfMs;

  let firstHalf = 0;
  let secondHalf = 0;

  for (const incident of incidents) {
    const ms = new Date(incident.date).getTime();
    if (ms < midpoint) {
      firstHalf++;
    } else {
      secondHalf++;
    }
  }

  if (firstHalf === 0) return "unknown";

  const ratio = secondHalf / firstHalf;
  if (ratio > 1.2) return "increasing";
  if (ratio < 0.8) return "decreasing";
  return "stable";
}
