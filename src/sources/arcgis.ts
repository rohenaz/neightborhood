import { buildBoundingBox } from "../geocode.ts";
import type { RawIncident } from "../types.ts";

// Public ArcGIS Feature Services — no auth required
// Covers Southeast Michigan including Macomb County (Sterling Heights 48310-48314)

interface ArcGISEndpoint {
  name: string;
  url: string;
  typeField: string;
  dateField: string;
  addressField: string;
}

const ENDPOINTS: ArcGISEndpoint[] = [
  {
    name: "macomb-county",
    url: "https://gis.macombgov.org/arcgis/rest/services/PublicSafety/CrimeMapping/FeatureServer/0",
    typeField: "OFFENSE",
    dateField: "INCIDENT_DATE",
    addressField: "ADDRESS",
  },
  {
    name: "semcog",
    url: "https://gis.semcog.org/arcgis/rest/services/CrimeData/CrimeIncidents/FeatureServer/0",
    typeField: "crime_type",
    dateField: "incident_date",
    addressField: "address",
  },
  {
    // Macomb County Sheriff fallback layer
    name: "macomb-sheriff",
    url: "https://gis.macombgov.org/arcgis/rest/services/Sheriff/CrimeData/FeatureServer/0",
    typeField: "OFFENSE_TYPE",
    dateField: "DATE_OF_INCIDENT",
    addressField: "INCIDENT_ADDRESS",
  },
];

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: {
    x: number;
    y: number;
  };
}

interface ArcGISGeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: Record<string, unknown>;
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  error?: { code: number; message: string };
}

interface ArcGISGeoJSONResponse {
  type?: string;
  features?: ArcGISGeoJSONFeature[];
  error?: { code: number; message: string };
}

function parseArcGISDate(value: unknown): string {
  if (typeof value === "number") {
    // Epoch milliseconds
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function extractString(obj: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (v && typeof v === "string") return v.trim();
    if (v !== null && v !== undefined) return String(v).trim();
  }
  return "";
}

async function queryEndpoint(
  endpoint: ArcGISEndpoint,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  days: number,
  sourcePrefix: string
): Promise<RawIncident[]> {
  const geometry = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  // Build where clause to filter by date if possible
  const whereClause = `1=1`;

  const params = new URLSearchParams({
    where: whereClause,
    geometry,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    f: "geojson",
    resultRecordCount: "500",
  });

  const url = `${endpoint.url}/query?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `ArcGIS ${endpoint.name} error: HTTP ${response.status} ${response.statusText}`
    );
  }

  const data = (await response.json()) as ArcGISGeoJSONResponse;

  if (data.error) {
    throw new Error(
      `ArcGIS ${endpoint.name} error: ${data.error.code} — ${data.error.message}`
    );
  }

  if (!data.features || !Array.isArray(data.features)) {
    return [];
  }

  const results: RawIncident[] = [];

  for (let i = 0; i < data.features.length; i++) {
    const feature = data.features[i];
    if (!feature) continue;

    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates;

    if (!coords || coords.length < 2) continue;

    const lng = coords[0];
    const lat = coords[1];
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (lat === 0 && lng === 0) continue;

    const rawDate = props[endpoint.dateField];
    const dateStr = parseArcGISDate(rawDate);

    // Filter by date range
    const incidentMs = new Date(dateStr).getTime();
    if (incidentMs < cutoffMs) continue;

    const type =
      extractString(props as Record<string, unknown>, endpoint.typeField, "OFFENSE", "offense_type", "crime_type") || "Other";
    const address =
      extractString(props as Record<string, unknown>, endpoint.addressField, "ADDRESS", "address", "LOCATION") ||
      "Unknown";

    results.push({
      source: "arcgis",
      id: `${sourcePrefix}-${endpoint.name}-${i}`,
      type,
      description: `${type} at ${address}`,
      date: dateStr,
      address,
      lat,
      lng,
    });
  }

  return results;
}

// Also try the plain JSON (non-GeoJSON) response format
async function queryEndpointJSON(
  endpoint: ArcGISEndpoint,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  days: number,
  sourcePrefix: string
): Promise<RawIncident[]> {
  const geometry = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;

  const params = new URLSearchParams({
    where: "1=1",
    geometry,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    outSR: "4326",
    f: "json",
    resultRecordCount: "500",
  });

  const url = `${endpoint.url}/query?${params.toString()}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(
      `ArcGIS ${endpoint.name} (json) error: HTTP ${response.status}`
    );
  }

  const data = (await response.json()) as ArcGISResponse;

  if (data.error) {
    throw new Error(
      `ArcGIS ${endpoint.name} error: ${data.error.code} — ${data.error.message}`
    );
  }

  if (!data.features || !Array.isArray(data.features)) {
    return [];
  }

  const results: RawIncident[] = [];

  for (let i = 0; i < data.features.length; i++) {
    const feature = data.features[i];
    if (!feature) continue;
    if (!feature.geometry) continue;

    const lng = feature.geometry.x;
    const lat = feature.geometry.y;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (lat === 0 && lng === 0) continue;

    const props = feature.attributes;
    const rawDate = props[endpoint.dateField];
    const dateStr = parseArcGISDate(rawDate);

    const incidentMs = new Date(dateStr).getTime();
    if (incidentMs < cutoffMs) continue;

    const type =
      extractString(props, endpoint.typeField, "OFFENSE", "offense_type", "crime_type") || "Other";
    const address =
      extractString(props, endpoint.addressField, "ADDRESS", "address", "LOCATION") ||
      "Unknown";

    results.push({
      source: "arcgis",
      id: `${sourcePrefix}-${endpoint.name}-${i}`,
      type,
      description: `${type} at ${address}`,
      date: dateStr,
      address,
      lat,
      lng,
    });
  }

  return results;
}

export async function fetchArcGIS(
  lat: number,
  lng: number,
  radiusMiles: number,
  days: number
): Promise<RawIncident[]> {
  const bbox = buildBoundingBox(lat, lng, radiusMiles);
  const prefix = `arc-${Date.now()}`;

  const results = await Promise.allSettled(
    ENDPOINTS.map(async (endpoint) => {
      // Try GeoJSON first, fall back to plain JSON
      try {
        return await queryEndpoint(endpoint, bbox, days, prefix);
      } catch {
        return await queryEndpointJSON(endpoint, bbox, days, prefix);
      }
    })
  );

  const incidents: RawIncident[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      incidents.push(...result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  // If ALL endpoints failed, propagate the error
  if (errors.length === ENDPOINTS.length) {
    throw new Error(`All ArcGIS endpoints failed: ${errors.join("; ")}`);
  }

  return incidents;
}
