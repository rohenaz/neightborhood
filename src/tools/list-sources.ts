import type { IncidentSource, SourceStatus } from "../types.ts";

const SOURCE_METADATA: Array<{
  name: IncidentSource;
  label: string;
  coverage: string;
  updateFrequency: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  testUrl: string;
}> = [
  {
    name: "spotcrime",
    label: "SpotCrime",
    coverage: "National — aggregates police blotter data",
    updateFrequency: "Daily",
    requiresApiKey: false, // uses demo key by default
    apiKeyEnvVar: "SPOTCRIME_API_KEY",
    testUrl: "https://api.spotcrime.com/crimes.json",
  },
  {
    name: "crimemapping",
    label: "CrimeMapping (Axon)",
    coverage: "Participating police agencies — good Macomb County coverage",
    updateFrequency: "Daily",
    requiresApiKey: false,
    testUrl: "https://www.crimemapping.com/",
  },
  {
    name: "arcgis",
    label: "ArcGIS Feature Services",
    coverage: "Macomb County GIS + SEMCOG Southeast Michigan",
    updateFrequency: "Varies by agency — typically daily to weekly",
    requiresApiKey: false,
    testUrl: "https://gis.macombgov.org/arcgis/rest/services",
  },
  {
    name: "nsopw",
    label: "National Sex Offender Registry (NSOPW)",
    coverage: "National — all 50 states + DC + territories",
    updateFrequency: "Real-time (pulled from state registries)",
    requiresApiKey: false,
    testUrl: "https://www.nsopw.gov/",
  },
  {
    name: "fbi",
    label: "FBI Crime Data Explorer (CDE)",
    coverage: "National — NIBRS aggregate data by agency ORI",
    updateFrequency: "Annual (prior year data)",
    requiresApiKey: true,
    apiKeyEnvVar: "FBI_API_KEY",
    testUrl: "https://api.usa.gov/crime/fbi/cde/",
  },
  {
    name: "news",
    label: "Crime News RSS Feeds",
    coverage: "Google News + Patch.com local (Sterling Heights / Macomb)",
    updateFrequency: "Real-time (RSS)",
    requiresApiKey: false,
    testUrl: "https://news.google.com/rss/search?q=crime",
  },
];

async function checkSourceOnline(testUrl: string): Promise<boolean> {
  try {
    const response = await fetch(testUrl, {
      method: "HEAD",
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "neighborhood-mcp/1.0" },
    });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}

export async function listSources(): Promise<SourceStatus[]> {
  const checks = await Promise.allSettled(
    SOURCE_METADATA.map(async (meta) => {
      const online = await checkSourceOnline(meta.testUrl);
      const hasApiKey = meta.requiresApiKey
        ? Boolean(meta.apiKeyEnvVar && process.env[meta.apiKeyEnvVar])
        : true;

      const status: SourceStatus = {
        name: meta.name,
        label: meta.label,
        online,
        coverage: meta.coverage,
        updateFrequency: meta.updateFrequency,
        requiresApiKey: meta.requiresApiKey,
        apiKeyEnvVar: meta.apiKeyEnvVar,
        hasApiKey,
        lastChecked: new Date().toISOString(),
      };

      if (meta.requiresApiKey && !hasApiKey) {
        status.error = `Missing API key: set ${meta.apiKeyEnvVar} environment variable`;
      }

      return status;
    })
  );

  return checks.map((result, i): SourceStatus => {
    const meta = SOURCE_METADATA[i];
    if (result.status === "fulfilled") return result.value;

    // Should not happen since we catch internally, but handle it
    return {
      name: meta?.name ?? ("unknown" as IncidentSource),
      label: meta?.label ?? "Unknown",
      online: false,
      coverage: meta?.coverage ?? "Unknown",
      updateFrequency: meta?.updateFrequency ?? "Unknown",
      requiresApiKey: meta?.requiresApiKey ?? false,
      hasApiKey: false,
      lastChecked: new Date().toISOString(),
      error:
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason),
    };
  });
}
