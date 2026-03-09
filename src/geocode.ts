import { geocodeCache } from "./cache.ts";
import type { Coordinates } from "./types.ts";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "neighborhood-mcp/1.0 (crime-data-aggregator)";

// State abbreviation/name → capital city ZIP code
const STATE_TO_ZIP: Record<string, string> = {
  AL: "36104", AK: "99801", AZ: "85001", AR: "72201", CA: "95814",
  CO: "80202", CT: "06103", DE: "19901", FL: "32301", GA: "30303",
  HI: "96813", ID: "83702", IL: "62701", IN: "46204", IA: "50309",
  KS: "66603", KY: "40601", LA: "70802", ME: "04330", MD: "21401",
  MA: "02201", MI: "48933", MN: "55101", MS: "39201", MO: "65101",
  MT: "59601", NE: "68502", NV: "89701", NH: "03301", NJ: "08608",
  NM: "87501", NY: "12207", NC: "27601", ND: "58501", OH: "43215",
  OK: "73102", OR: "97301", PA: "17101", RI: "02903", SC: "29201",
  SD: "57501", TN: "37219", TX: "78701", UT: "84111", VT: "05602",
  VA: "23219", WA: "98501", WV: "25301", WI: "53703", WY: "82001",
  DC: "20001",
};

const STATE_NAMES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC", dc: "DC",
};

/**
 * Resolve a location string to a ZIP code.
 * Accepts: ZIP code, state abbreviation ("AL"), or state name ("Alabama").
 * Returns { zip, label } where label is a human-friendly description for state lookups.
 */
export function resolveLocation(input: string): { zip: string; label: string } | null {
  const trimmed = input.trim();

  // Already a ZIP code
  if (/^\d{5}$/.test(trimmed)) {
    return { zip: trimmed, label: trimmed };
  }

  // State abbreviation (case-insensitive)
  const upper = trimmed.toUpperCase();
  if (STATE_TO_ZIP[upper]) {
    return { zip: STATE_TO_ZIP[upper], label: `${upper} (capital area)` };
  }

  // Full state name (case-insensitive)
  const lower = trimmed.toLowerCase();
  const abbr = STATE_NAMES[lower];
  if (abbr && STATE_TO_ZIP[abbr]) {
    return { zip: STATE_TO_ZIP[abbr], label: `${abbr} (capital area)` };
  }

  return null;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  boundingbox: [string, string, string, string]; // [minLat, maxLat, minLng, maxLng]
}

export async function zipToCoordinates(zipCode: string): Promise<Coordinates> {
  const cacheKey = `zip:${zipCode}`;
  const cached = geocodeCache.get(cacheKey);
  if (cached) return cached;

  const url = new URL(`${NOMINATIM_BASE}/search`);
  url.searchParams.set("postalcode", zipCode);
  url.searchParams.set("country", "US");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(
      `Nominatim geocoding failed: HTTP ${response.status} ${response.statusText}`
    );
  }

  const results = (await response.json()) as NominatimResult[];

  if (!results.length) {
    throw new Error(`No coordinates found for zip code: ${zipCode}`);
  }

  const result = results[0];
  if (!result) {
    throw new Error(`No coordinates found for zip code: ${zipCode}`);
  }

  const coords: Coordinates = {
    lat: Number.parseFloat(result.lat),
    lng: Number.parseFloat(result.lon),
    displayName: result.display_name,
    boundingBox: {
      minLat: Number.parseFloat(result.boundingbox[0]),
      maxLat: Number.parseFloat(result.boundingbox[1]),
      minLng: Number.parseFloat(result.boundingbox[2]),
      maxLng: Number.parseFloat(result.boundingbox[3]),
    },
  };

  geocodeCache.set(cacheKey, coords);
  return coords;
}

/**
 * Convert radius in miles to approximate degrees (for bounding box queries).
 * 1 degree latitude ≈ 69 miles. Longitude varies by latitude.
 */
export function milesToDegrees(
  miles: number,
  lat: number
): { latDelta: number; lngDelta: number } {
  const latDelta = miles / 69.0;
  const lngDelta = miles / (69.0 * Math.cos((lat * Math.PI) / 180));
  return { latDelta, lngDelta };
}

/**
 * Build a bounding box [minLng, minLat, maxLng, maxLat] from center + radius in miles.
 */
export function buildBoundingBox(
  lat: number,
  lng: number,
  radiusMiles: number
): { minLat: number; maxLat: number; minLng: number; maxLng: number } {
  const { latDelta, lngDelta } = milesToDegrees(radiusMiles, lat);
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

/**
 * Convert radius in miles to degrees (used by SpotCrime which takes a radius in degrees).
 */
export function milesToDegreesSimple(miles: number): number {
  return miles / 69.0;
}
