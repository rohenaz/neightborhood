import { buildBoundingBox } from "../geocode.ts";
import type { RawIncident } from "../types.ts";

// CrimeMapping (Axon) internal API — browser-style requests, no official key
const SEARCH_URL = "https://www.crimemapping.com/api/CrimeSearch";

interface CrimeMappingAgency {
  ORI: string;
  AgencyName: string;
}

interface CrimeMappingRecord {
  IncidentID?: string | number;
  CrimeType?: string;
  Offense?: string;
  Description?: string;
  DateOccurred?: string;
  IncidentDate?: string;
  Address?: string;
  FullAddress?: string;
  Latitude?: number;
  Longitude?: number;
  Lat?: number;
  Lng?: number;
  lon?: number;
  lat?: number;
  Agency?: string;
  ORI?: string;
}

interface CrimeMappingResponse {
  Incidents?: CrimeMappingRecord[];
  crimes?: CrimeMappingRecord[];
  features?: Array<{
    attributes?: CrimeMappingRecord;
    geometry?: { x: number; y: number };
  }>;
}

function formatDate(daysBack: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysBack);
  return d.toISOString().split("T")[0] ?? "";
}

function today(): string {
  return new Date().toISOString().split("T")[0] ?? "";
}

function normalizeRecord(record: CrimeMappingRecord, idx: number): RawIncident {
  const lat = record.Latitude ?? record.Lat ?? record.lat ?? 0;
  const lng = record.Longitude ?? record.Lng ?? record.lon ?? 0;
  const type =
    record.CrimeType ?? record.Offense ?? record.Description ?? "Other";
  const address = record.Address ?? record.FullAddress ?? "Unknown";
  const rawDate = record.DateOccurred ?? record.IncidentDate ?? "";
  const date = rawDate
    ? new Date(rawDate).toISOString()
    : new Date().toISOString();
  const id = record.IncidentID
    ? `cm-${record.IncidentID}`
    : `cm-${lat}-${lng}-${idx}`;

  return {
    source: "crimemapping",
    id,
    type: type.trim() || "Other",
    description: `${type} at ${address}`,
    date,
    address,
    lat,
    lng,
  };
}

export async function fetchCrimeMapping(
  lat: number,
  lng: number,
  radiusMiles: number,
  days: number
): Promise<RawIncident[]> {
  const bbox = buildBoundingBox(lat, lng, radiusMiles);
  const startDate = formatDate(days);
  const endDate = today();

  const body = JSON.stringify({
    startDate,
    endDate,
    typeOfCrime: [],
    zoomLevel: 12,
    lat,
    lng,
    radius: radiusMiles,
    bbox: [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat],
  });

  const response = await fetch(SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://www.crimemapping.com/",
      Origin: "https://www.crimemapping.com",
    },
    body,
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `CrimeMapping API error: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as CrimeMappingResponse;

  // Handle various response shapes
  const records: CrimeMappingRecord[] = [];
  if (data.Incidents && Array.isArray(data.Incidents)) {
    records.push(...data.Incidents);
  } else if (data.crimes && Array.isArray(data.crimes)) {
    records.push(...data.crimes);
  } else if (data.features && Array.isArray(data.features)) {
    for (const f of data.features) {
      if (f.attributes) {
        const rec = { ...f.attributes };
        if (f.geometry) {
          rec.Longitude = f.geometry.x;
          rec.Latitude = f.geometry.y;
        }
        records.push(rec);
      }
    }
  }

  if (!records.length) {
    // Not an error — area may just have no data from this source
    return [];
  }

  return records
    .filter((r) => {
      const lat = r.Latitude ?? r.Lat ?? r.lat;
      const lng = r.Longitude ?? r.Lng ?? r.lon;
      return (
        typeof lat === "number" &&
        typeof lng === "number" &&
        lat !== 0 &&
        lng !== 0
      );
    })
    .map((r, idx) => normalizeRecord(r, idx));
}

// Look up agencies covering a bounding box via the v2 API
export async function fetchCrimeMappingAgencies(
  lat: number,
  lng: number,
  radiusMiles: number,
  days: number
): Promise<RawIncident[]> {
  const bbox = buildBoundingBox(lat, lng, radiusMiles);

  // First get agencies for this area
  const agenciesUrl = `https://www.crimemapping.com/api/agencies?bbox=${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

  const agencyResp = await fetch(agenciesUrl, {
    headers: {
      Accept: "application/json",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
      Referer: "https://www.crimemapping.com/",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!agencyResp.ok) {
    throw new Error(
      `CrimeMapping agencies lookup failed: HTTP ${agencyResp.status}`
    );
  }

  const agencies = (await agencyResp.json()) as CrimeMappingAgency[];
  if (!agencies.length) return [];

  const oris = agencies.map((a) => a.ORI).filter(Boolean);

  const body = JSON.stringify({
    startDate: formatDate(days),
    endDate: today(),
    typeOfCrime: [],
    agencyORIs: oris,
  });

  const crimesResp = await fetch(
    "https://api.crimemapping.com/crimes/v2/GetCrimesSpecificAgencies",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
        Referer: "https://www.crimemapping.com/",
        Origin: "https://www.crimemapping.com",
      },
      body,
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!crimesResp.ok) {
    throw new Error(
      `CrimeMapping v2 crimes fetch failed: HTTP ${crimesResp.status}`
    );
  }

  const data = (await crimesResp.json()) as CrimeMappingResponse;
  const records: CrimeMappingRecord[] = [];

  if (data.Incidents && Array.isArray(data.Incidents)) {
    records.push(...data.Incidents);
  } else if (data.features && Array.isArray(data.features)) {
    for (const f of data.features) {
      if (f.attributes) {
        const rec = { ...f.attributes };
        if (f.geometry) {
          rec.Longitude = f.geometry.x;
          rec.Latitude = f.geometry.y;
        }
        records.push(rec);
      }
    }
  }

  return records
    .filter((r) => {
      const lat = r.Latitude ?? r.Lat ?? r.lat;
      const lng = r.Longitude ?? r.Lng ?? r.lon;
      return (
        typeof lat === "number" &&
        typeof lng === "number" &&
        lat !== 0 &&
        lng !== 0
      );
    })
    .map((r, idx) => normalizeRecord(r, idx));
}
