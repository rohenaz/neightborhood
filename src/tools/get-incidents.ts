import { zipToCoordinates } from "../geocode.ts";
import { buildFeatureCollection } from "../normalize.ts";
import { fetchArcGIS } from "../sources/arcgis.ts";
import { fetchCrimeMapping } from "../sources/crimemapping.ts";
import { fetchFBI } from "../sources/fbi.ts";
import { fetchNewsAsIncidents } from "../sources/news.ts";
import { fetchNSOPW } from "../sources/nsopw.ts";
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

const ALL_SOURCES: IncidentSource[] = [
  "spotcrime",
  "crimemapping",
  "arcgis",
  "nsopw",
  "fbi",
  "news",
];

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
      source: "spotcrime" as const,
      fetch: () => fetchSpotCrime(lat, lng, radius),
    },
    {
      source: "crimemapping" as const,
      fetch: () => fetchCrimeMapping(lat, lng, radius, days),
    },
    {
      source: "arcgis" as const,
      fetch: () => fetchArcGIS(lat, lng, radius, days),
    },
    {
      source: "nsopw" as const,
      fetch: () => fetchNSOPW(zipCode, radius),
    },
    {
      source: "fbi" as const,
      fetch: () => fetchFBI(lat, lng, radius),
    },
    {
      source: "news" as const,
      fetch: () => fetchNewsAsIncidents(zipCode, lat, lng),
    },
  ];
  const sourceFetchers = allFetchers.filter((f) =>
    enabledSources.includes(f.source)
  );

  const results = await Promise.allSettled(
    sourceFetchers.map(({ fetch }) => fetch())
  );

  const allIncidents: RawIncident[] = [];
  const sourceErrors: SourceError[] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const fetcher = sourceFetchers[i];
    if (!result || !fetcher) continue;

    if (result.status === "fulfilled") {
      allIncidents.push(...result.value);
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
    }
  }

  // Filter by date range
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const filtered = allIncidents.filter((incident) => {
    // FBI data is annual — always include it regardless of date filter
    if (incident.source === "fbi") return true;
    try {
      return new Date(incident.date) >= cutoff;
    } catch {
      return true;
    }
  });

  return buildFeatureCollection(zipCode, radius, days, filtered, sourceErrors);
}
