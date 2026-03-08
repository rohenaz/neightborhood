import type { RawIncident } from "../types.ts";

// FBI Crime Data Explorer — https://api.usa.gov/crime/fbi/cde/
// Returns annual aggregate data — used for historical context + stats layer.
// Requires a free API key from api.data.gov (env: FBI_API_KEY)

const FBI_BASE = "https://api.usa.gov/crime/fbi/cde";

// ORI codes for agencies covering Sterling Heights / Macomb County, MI
// Sterling Heights PD: MI0500900
// Macomb County Sheriff: MI0500000
// Michigan State Police Macomb: MI0500600
const MACOMB_ORIS = ["MI0500900", "MI0500000", "MI0500600"];

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
  _radiusMiles: number
): Promise<RawIncident[]> {
  const apiKey = process.env["FBI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY is not set. Get a free key at https://api.data.gov/signup"
    );
  }

  const currentYear = new Date().getFullYear();
  const reportYear = currentYear - 1; // FBI data is typically 1 year behind

  const results = await Promise.allSettled(
    MACOMB_ORIS.map((ori) => fetchAgencyOffenses(ori, apiKey, reportYear))
  );

  const incidents: RawIncident[] = [];

  // Agency locations for Macomb County (hardcoded since FBI data is aggregate)
  const agencyLocations: Record<string, { lat: number; lng: number; name: string }> = {
    MI0500900: { lat: 42.5803, lng: -83.0302, name: "Sterling Heights PD" },
    MI0500000: { lat: 42.6665, lng: -82.9263, name: "Macomb County Sheriff" },
    MI0500600: { lat: 42.5584, lng: -82.9371, name: "MSP Macomb Post" },
  };

  // Use provided coordinates as fallback for unknown ORIs
  const fallbackLocation = { lat, lng, name: "Local Agency" };

  for (let i = 0; i < MACOMB_ORIS.length; i++) {
    const ori = MACOMB_ORIS[i];
    if (!ori) continue;

    const result = results[i];
    if (!result || result.status === "rejected") continue;

    const location = agencyLocations[ori] ?? fallbackLocation;
    const offenses = result.value;

    for (const offense of offenses) {
      if (!offense.offense_name || !offense.count) continue;

      // Generate one representative incident per offense type
      incidents.push({
        source: "fbi",
        id: `fbi-${ori}-${offense.offense_name}-${reportYear}`,
        type: offense.offense_name,
        description: `${offense.offense_name}: ${offense.count} incidents reported in ${reportYear} (${agencyLocations[ori]?.name ?? "local agency"})`,
        date: `${reportYear}-12-31T00:00:00.000Z`,
        address: location.name,
        lat: location.lat,
        lng: location.lng,
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

export async function fetchFBIStats(): Promise<FBIStats[]> {
  const apiKey = process.env["FBI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "FBI_API_KEY is not set. Get a free key at https://api.data.gov/signup"
    );
  }

  const reportYear = new Date().getFullYear() - 1;

  const results = await Promise.allSettled(
    MACOMB_ORIS.map((ori) => fetchAgencyOffenses(ori, apiKey, reportYear))
  );

  const agencyNames: Record<string, string> = {
    MI0500900: "Sterling Heights PD",
    MI0500000: "Macomb County Sheriff",
    MI0500600: "MSP Macomb Post",
  };

  return MACOMB_ORIS.map((ori, i): FBIStats => {
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
      agencyName: agencyNames[ori] ?? ori,
      ori,
      offenses,
    };
  });
}
