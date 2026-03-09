import { zipToCoordinates } from "../geocode.ts";
import { fetchNewsAlerts } from "../sources/news.ts";
import type { AlertsResult, SourceError } from "../types.ts";

export interface GetAlertsInput {
  zipCode: string;
  keywords?: string[];
  limit?: number;
}

export async function getAlerts(input: GetAlertsInput): Promise<AlertsResult> {
  const { zipCode, keywords = [], limit = 20 } = input;
  const sourceErrors: SourceError[] = [];

  // Geocode to get the display name for location-aware news queries
  let locationName: string | undefined;
  try {
    const coords = await zipToCoordinates(zipCode);
    locationName = coords.displayName;
  } catch {
    // If geocoding fails, we'll still search by zip code alone
  }

  let alerts: Awaited<ReturnType<typeof fetchNewsAlerts>> = [];

  try {
    alerts = await fetchNewsAlerts(zipCode, keywords, locationName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[news] alerts fetch failed: ${msg}`);
    sourceErrors.push({
      source: "news",
      error: msg,
      timestamp: new Date().toISOString(),
    });
  }

  const totalCount = alerts.length;
  const trimmed = alerts.slice(0, limit).map(({ description, ...rest }) => rest);

  return {
    zipCode,
    alerts: trimmed,
    totalCount,
    showing: trimmed.length,
    generatedAt: new Date().toISOString(),
    sourceErrors,
  };
}
