import { geocodeCache } from "./cache.ts";
import type { Coordinates } from "./types.ts";

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const USER_AGENT = "neighborhood-mcp/1.0 (crime-data-aggregator)";

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
