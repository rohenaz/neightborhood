import { buildBoundingBox } from "../geocode.ts";
import type { RawIncident } from "../types.ts";

// ArcGIS Open Data — searches for public crime feature services near coordinates.
// No API key required. Coverage varies by region.

interface ArcGISSearchResult {
  id: string;
  name: string;
  url: string;
}

interface ArcGISSearchResponse {
  results?: Array<{
    id?: string;
    title?: string;
    name?: string;
    url?: string;
  }>;
  total?: number;
}

interface ArcGISFeature {
  attributes: Record<string, unknown>;
  geometry?: { x: number; y: number };
}

interface ArcGISResponse {
  features?: ArcGISFeature[];
  fields?: Array<{ name: string; type: string; alias?: string }>;
  error?: { code: number; message: string };
}

// Search ArcGIS Online for public crime-related feature services near given bbox
async function discoverCrimeServices(bbox: {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}): Promise<ArcGISSearchResult[]> {
  const bboxStr = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
  const params = new URLSearchParams({
    q: 'crime OR incidents OR offenses type:"Feature Service"',
    bbox: bboxStr,
    sortField: "numviews",
    sortOrder: "desc",
    num: "5",
    f: "json",
  });

  const url = `https://www.arcgis.com/sharing/rest/search?${params}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error(`ArcGIS search error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as ArcGISSearchResponse;
  if (!data.results?.length) return [];

  return data.results
    .filter((r) => r.url)
    .map((r) => ({
      id: r.id ?? "unknown",
      name: r.title ?? r.name ?? "Unknown",
      url: r.url as string,
    }));
}

function parseArcGISDate(value: unknown): string {
  if (typeof value === "number") {
    return new Date(value).toISOString();
  }
  if (typeof value === "string" && value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

function extractString(
  obj: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const key of keys) {
    const v = obj[key];
    if (v && typeof v === "string") return v.trim();
    if (v !== null && v !== undefined) return String(v).trim();
  }
  return "";
}

// Common field name patterns across different ArcGIS crime services
const TYPE_FIELDS = [
  "OFFENSE",
  "offense",
  "OFFENSE_TYPE",
  "offense_type",
  "crime_type",
  "CrimeType",
  "CRIME_TYPE",
  "TYPE",
  "type",
  "CATEGORY",
  "category",
  "Description",
  "DESCRIPTION",
  "UCR_DESCRIPTION",
];

const DATE_FIELDS = [
  "INCIDENT_DATE",
  "incident_date",
  "DATE_OF_INCIDENT",
  "date_of_incident",
  "DATE_REPORTED",
  "date_reported",
  "OCCURRED_DATE",
  "occurred_date",
  "RPT_DATE",
  "rpt_date",
  "DATE",
  "date",
  "DateOccur",
  "ReportDate",
];

const ADDRESS_FIELDS = [
  "ADDRESS",
  "address",
  "INCIDENT_ADDRESS",
  "incident_address",
  "LOCATION",
  "location",
  "BLOCK",
  "block",
  "BLOCK_ADDRESS",
  "Street",
  "STREET",
];

function findField(fields: string[], candidates: string[]): string | undefined {
  const lower = new Set(fields.map((f) => f.toLowerCase()));
  return candidates.find((c) => lower.has(c.toLowerCase()));
}

async function queryService(
  serviceUrl: string,
  serviceName: string,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  days: number,
  prefix: string
): Promise<RawIncident[]> {
  // First try layer 0 of the service
  const layerUrl = serviceUrl.includes("/FeatureServer")
    ? serviceUrl
    : `${serviceUrl.replace(/\/$/, "")}/FeatureServer/0`;

  const geometry = `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;

  const params = new URLSearchParams({
    where: "1=1",
    geometry,
    geometryType: "esriGeometryEnvelope",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    outSR: "4326",
    f: "json",
    resultRecordCount: "200",
  });

  const url = `${layerUrl}/query?${params}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    throw new Error(`ArcGIS ${serviceName} error: HTTP ${response.status}`);
  }

  const data = (await response.json()) as ArcGISResponse;
  if (data.error) {
    throw new Error(
      `ArcGIS ${serviceName} error: ${data.error.code} — ${data.error.message}`
    );
  }

  if (!data.features?.length) return [];

  // Detect field mappings from available fields
  const availableFields = data.fields?.map((f) => f.name) ?? [];
  if (availableFields.length === 0 && data.features[0]) {
    availableFields.push(...Object.keys(data.features[0].attributes));
  }

  const typeField = findField(availableFields, TYPE_FIELDS) ?? "OFFENSE";
  const dateField = findField(availableFields, DATE_FIELDS) ?? "DATE";
  const addressField = findField(availableFields, ADDRESS_FIELDS) ?? "ADDRESS";

  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const results: RawIncident[] = [];

  for (let i = 0; i < data.features.length; i++) {
    const feature = data.features[i];
    if (!feature?.geometry) continue;

    const lng = feature.geometry.x;
    const lat = feature.geometry.y;
    if (typeof lat !== "number" || typeof lng !== "number") continue;
    if (lat === 0 && lng === 0) continue;

    const props = feature.attributes;
    const dateStr = parseArcGISDate(props[dateField]);

    const incidentMs = new Date(dateStr).getTime();
    if (incidentMs < cutoffMs) continue;

    const type = extractString(props, typeField, ...TYPE_FIELDS) || "Other";
    const address =
      extractString(props, addressField, ...ADDRESS_FIELDS) || "Unknown";

    results.push({
      source: "arcgis",
      id: `${prefix}-${serviceName}-${i}`,
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

  // Discover public crime feature services near these coordinates
  const services = await discoverCrimeServices(bbox);
  if (services.length === 0) {
    return []; // No crime feature services found in this area — not an error
  }

  const results = await Promise.allSettled(
    services.map((svc) => queryService(svc.url, svc.name, bbox, days, prefix))
  );

  const incidents: RawIncident[] = [];
  const errors: string[] = [];

  for (const result of results) {
    if (result.status === "fulfilled") {
      incidents.push(...result.value);
    } else {
      errors.push(
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason)
      );
    }
  }

  // Only throw if ALL discovered services failed
  if (incidents.length === 0 && errors.length > 0) {
    throw new Error(
      `All ArcGIS services failed: ${errors.slice(0, 3).join("; ")}`
    );
  }

  return incidents;
}
