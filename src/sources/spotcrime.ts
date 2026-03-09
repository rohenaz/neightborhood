import { milesToDegreesSimple } from "../geocode.ts";
import type { RawIncident } from "../types.ts";

const BASE_URL = "https://api.spotcrime.com/crimes.json";

interface SpotCrimeRecord {
  type: string;
  date: string;
  address: string;
  lat: number;
  lon: number;
  link?: string;
  id?: string | number;
}

interface SpotCrimeResponse {
  crimes: SpotCrimeRecord[];
}

function normalizeType(raw: string): string {
  const map: Record<string, string> = {
    THEFT: "Theft",
    BURGLARY: "Burglary",
    ROBBERY: "Robbery",
    ASSAULT: "Assault",
    SHOOTING: "Shooting",
    ARREST: "Arrest",
    VANDALISM: "Vandalism",
    MOTOR: "Auto Theft",
    RAPE: "Rape",
    ARSON: "Arson",
  };
  const upper = raw.toUpperCase();
  for (const [key, label] of Object.entries(map)) {
    if (upper.includes(key)) return label;
  }
  return raw.trim() || "Other";
}

function parseSpotCrimeDate(raw: string): string {
  // SpotCrime returns dates like "1/15/2025 10:30 AM"
  try {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  } catch {
    // fall through
  }
  return new Date().toISOString();
}

export async function fetchSpotCrime(
  lat: number,
  lng: number,
  radiusMiles: number
): Promise<RawIncident[]> {
  const apiKey = process.env.SPOTCRIME_API_KEY;
  if (!apiKey) {
    throw new Error(
      "SPOTCRIME_API_KEY is not set. Get a key at https://spotcrime.com/police/api"
    );
  }
  const radiusDegrees = milesToDegreesSimple(radiusMiles);

  const url = new URL(BASE_URL);
  url.searchParams.set("lat", lat.toString());
  url.searchParams.set("lon", lng.toString());
  url.searchParams.set("radius", radiusDegrees.toFixed(4));
  url.searchParams.set("key", apiKey);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(
      `SpotCrime API error: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as SpotCrimeResponse;

  if (!data.crimes || !Array.isArray(data.crimes)) {
    throw new Error(
      "SpotCrime: unexpected response structure — missing crimes array"
    );
  }

  return data.crimes.map((crime, idx): RawIncident => {
    const type = normalizeType(crime.type ?? "Other");
    const id = crime.id ? String(crime.id) : `spotcrime-${lat}-${lng}-${idx}`;
    return {
      source: "spotcrime",
      id,
      type,
      description: `${type} reported at ${crime.address}`,
      date: parseSpotCrimeDate(crime.date),
      address: crime.address ?? "Unknown",
      lat: crime.lat,
      lng: crime.lon,
      url: crime.link,
    };
  });
}
