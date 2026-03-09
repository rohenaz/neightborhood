import type { RawIncident } from "../types.ts";

// FBI Crime Data Explorer — https://api.usa.gov/crime/fbi/cde/
// Returns annual aggregate data — used for historical context + stats layer.
// Requires a free API key from api.data.gov (env: FBI_API_KEY)

const FBI_BASE = "https://api.usa.gov/crime/fbi/cde";

// State abbreviation lookup from coordinates (simplified US mapping)
function stateFromCoords(lat: number, lng: number): string {
  // Use a reverse-geocode heuristic based on lat/lng bounding boxes
  // This covers the continental US; defaults to TX for demo purposes
  const states: Array<{
    abbr: string;
    latMin: number;
    latMax: number;
    lngMin: number;
    lngMax: number;
  }> = [
    { abbr: "TX", latMin: 25.8, latMax: 36.5, lngMin: -106.7, lngMax: -93.5 },
    { abbr: "CA", latMin: 32.5, latMax: 42.0, lngMin: -124.5, lngMax: -114.1 },
    { abbr: "NY", latMin: 40.5, latMax: 45.0, lngMin: -79.8, lngMax: -71.9 },
    { abbr: "FL", latMin: 24.5, latMax: 31.0, lngMin: -87.6, lngMax: -80.0 },
    { abbr: "IL", latMin: 36.9, latMax: 42.5, lngMin: -91.5, lngMax: -87.5 },
    { abbr: "PA", latMin: 39.7, latMax: 42.3, lngMin: -80.5, lngMax: -74.7 },
    { abbr: "OH", latMin: 38.4, latMax: 42.0, lngMin: -84.8, lngMax: -80.5 },
    { abbr: "GA", latMin: 30.4, latMax: 35.0, lngMin: -85.6, lngMax: -80.8 },
    { abbr: "NC", latMin: 33.8, latMax: 36.6, lngMin: -84.3, lngMax: -75.5 },
    { abbr: "MI", latMin: 41.7, latMax: 48.3, lngMin: -90.4, lngMax: -82.4 },
    { abbr: "WA", latMin: 45.5, latMax: 49.0, lngMin: -124.8, lngMax: -116.9 },
    { abbr: "AZ", latMin: 31.3, latMax: 37.0, lngMin: -114.8, lngMax: -109.0 },
    { abbr: "MA", latMin: 41.2, latMax: 42.9, lngMin: -73.5, lngMax: -69.9 },
    { abbr: "CO", latMin: 37.0, latMax: 41.0, lngMin: -109.1, lngMax: -102.0 },
    { abbr: "VA", latMin: 36.5, latMax: 39.5, lngMin: -83.7, lngMax: -75.2 },
    { abbr: "NJ", latMin: 38.9, latMax: 41.4, lngMin: -75.6, lngMax: -73.9 },
    { abbr: "TN", latMin: 35.0, latMax: 36.7, lngMin: -90.3, lngMax: -81.6 },
    { abbr: "IN", latMin: 37.8, latMax: 41.8, lngMin: -88.1, lngMax: -84.8 },
    { abbr: "MO", latMin: 36.0, latMax: 40.6, lngMin: -95.8, lngMax: -89.1 },
    { abbr: "MD", latMin: 37.9, latMax: 39.7, lngMin: -79.5, lngMax: -75.0 },
    { abbr: "WI", latMin: 42.5, latMax: 47.1, lngMin: -92.9, lngMax: -86.3 },
    { abbr: "MN", latMin: 43.5, latMax: 49.4, lngMin: -97.2, lngMax: -89.5 },
    { abbr: "OR", latMin: 42.0, latMax: 46.3, lngMin: -124.6, lngMax: -116.5 },
    { abbr: "LA", latMin: 28.9, latMax: 33.0, lngMin: -94.0, lngMax: -89.0 },
    { abbr: "AL", latMin: 30.2, latMax: 35.0, lngMin: -88.5, lngMax: -84.9 },
    { abbr: "SC", latMin: 32.0, latMax: 35.2, lngMin: -83.4, lngMax: -78.5 },
    { abbr: "KY", latMin: 36.5, latMax: 39.1, lngMin: -89.6, lngMax: -82.0 },
    { abbr: "OK", latMin: 33.6, latMax: 37.0, lngMin: -103.0, lngMax: -94.4 },
    { abbr: "CT", latMin: 41.0, latMax: 42.1, lngMin: -73.7, lngMax: -71.8 },
    { abbr: "NV", latMin: 35.0, latMax: 42.0, lngMin: -120.0, lngMax: -114.0 },
    { abbr: "UT", latMin: 37.0, latMax: 42.0, lngMin: -114.1, lngMax: -109.0 },
  ];

  for (const s of states) {
    if (
      lat >= s.latMin &&
      lat <= s.latMax &&
      lng >= s.lngMin &&
      lng <= s.lngMax
    ) {
      return s.abbr;
    }
  }
  return "TX"; // fallback
}

// Haversine distance in miles
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Find nearby FBI agency ORIs dynamically based on coordinates
async function findNearbyORIs(
  lat: number,
  lng: number,
  radiusMiles: number,
  apiKey: string
): Promise<Array<{ ori: string; name: string; lat: number; lng: number }>> {
  const state = stateFromCoords(lat, lng);
  const agencies = await fetchFBIAgenciesByState(state, apiKey);

  return agencies
    .filter(
      (
        a
      ): a is FBIAgency & {
        ori: string;
        latitude: number;
        longitude: number;
      } =>
        !!a.ori &&
        typeof a.latitude === "number" &&
        typeof a.longitude === "number"
    )
    .map((a) => ({
      ori: a.ori,
      name: a.agency_name ?? a.ori,
      lat: a.latitude,
      lng: a.longitude,
      distance: haversineDistance(lat, lng, a.latitude, a.longitude),
    }))
    .filter((a) => a.distance <= radiusMiles)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5); // top 5 nearest agencies
}

interface FBIOffense {
  offense_name?: string;
  count?: number;
  year?: number;
}

interface FBIAgencyOffensesResponse {
  data?: FBIOffense[];
  pagination?: { count: number; page: number; pages: number };
  errors?: string[];
}

interface FBIAgency {
  ori?: string;
  agency_name?: string;
  state_abbr?: string;
  latitude?: number;
  longitude?: number;
  county_name?: string;
}

interface FBIAgenciesResponse {
  results?: FBIAgency[];
  count?: number;
}

// Fetch offense counts for a specific ORI
async function fetchAgencyOffenses(
  ori: string,
  apiKey: string,
  year: number
): Promise<FBIOffense[]> {
  const url = `${FBI_BASE}/api/data/nibrs/offense/count/agencies/${ori}/offenses?api_key=${apiKey}&year=${year}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`FBI CDE ORI ${ori} error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as FBIAgencyOffensesResponse;

  if (data.errors?.length) {
    throw new Error(`FBI CDE error: ${data.errors.join(", ")}`);
  }

  return data.data ?? [];
}

// Look up agencies near a bounding box by state
export async function fetchFBIAgenciesByState(
  state: string,
  apiKey: string
): Promise<FBIAgency[]> {
  const url = `${FBI_BASE}/api/agencies/byStateAbbr/${state}?api_key=${apiKey}&per_page=100`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`FBI CDE agencies fetch error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as FBIAgenciesResponse;
  return data.results ?? [];
}

// FBI data is annual aggregates — we synthesize pseudo-incidents from offense counts
// positioned at the agency's known location with the current year's data.
// This gives historical context to pair with real-time sources.
export async function fetchFBI(
  lat: number,
  lng: number,
  radiusMiles: number
): Promise<RawIncident[]> {
  const apiKey = process.env.FBI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY is not set. Get a free key at https://api.data.gov/signup"
    );
  }

  const nearbyAgencies = await findNearbyORIs(lat, lng, radiusMiles, apiKey);
  if (nearbyAgencies.length === 0) return [];

  const currentYear = new Date().getFullYear();
  const reportYear = currentYear - 1; // FBI data is typically 1 year behind

  const results = await Promise.allSettled(
    nearbyAgencies.map((a) => fetchAgencyOffenses(a.ori, apiKey, reportYear))
  );

  const incidents: RawIncident[] = [];

  for (let i = 0; i < nearbyAgencies.length; i++) {
    const agency = nearbyAgencies[i];
    if (!agency) continue;

    const result = results[i];
    if (!result || result.status === "rejected") continue;

    for (const offense of result.value) {
      if (!offense.offense_name || !offense.count) continue;

      incidents.push({
        source: "fbi",
        id: `fbi-${agency.ori}-${offense.offense_name}-${reportYear}`,
        type: offense.offense_name,
        description: `${offense.offense_name}: ${offense.count} incidents reported in ${reportYear} (${agency.name})`,
        date: `${reportYear}-12-31T00:00:00.000Z`,
        address: agency.name,
        lat: agency.lat,
        lng: agency.lng,
        severity: undefined,
      });
    }
  }

  return incidents;
}

// Returns aggregate stats — useful for get_crime_stats tool
export interface FBIStats {
  year: number;
  agencyName: string;
  ori: string;
  offenses: Array<{ type: string; count: number }>;
}

export async function fetchFBIStats(
  lat: number,
  lng: number,
  radiusMiles: number
): Promise<FBIStats[]> {
  const apiKey = process.env.FBI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY is not set. Get a free key at https://api.data.gov/signup"
    );
  }

  const nearbyAgencies = await findNearbyORIs(lat, lng, radiusMiles, apiKey);
  if (nearbyAgencies.length === 0) return [];

  const reportYear = new Date().getFullYear() - 1;

  const results = await Promise.allSettled(
    nearbyAgencies.map((a) => fetchAgencyOffenses(a.ori, apiKey, reportYear))
  );

  return nearbyAgencies.map((agency, i): FBIStats => {
    const result = results[i];
    const offenses =
      result?.status === "fulfilled"
        ? result.value.map((o) => ({
            type: o.offense_name ?? "Unknown",
            count: o.count ?? 0,
          }))
        : [];

    return {
      year: reportYear,
      agencyName: agency.name,
      ori: agency.ori,
      offenses,
    };
  });
}
