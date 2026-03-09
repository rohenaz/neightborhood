import { buildBoundingBox } from "../geocode.ts";
import type { RawIncident } from "../types.ts";

// Socrata SODA API — discovers and queries open crime datasets from US city data portals.
// No API key required for public datasets. Covers hundreds of cities.

// Uses a two-tier strategy:
// 1. A curated registry of known high-quality crime datasets with their geo coverage
// 2. The Socrata catalog API for discovering additional datasets

interface CatalogResult {
  resource: {
    id: string;
    name: string;
    columns_field_name: string[];
    columns_datatype: string[];
  };
  metadata: {
    domain: string;
  };
  classification?: {
    domain_category?: string;
  };
}

interface CatalogResponse {
  results: CatalogResult[];
  resultSetSize?: number;
}

interface SocrataRecord {
  [key: string]: unknown;
}

// Known high-quality Socrata crime datasets with approximate city center coordinates.
// These are verified to have point-level geo data and recent incidents.
// The lat/lng define the city center; radiusMiles defines the coverage area.
const KNOWN_DATASETS: Array<{
  domain: string;
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusMiles: number;
}> = [
  // Chicago — Crimes 2001 to Present (huge, well-maintained)
  {
    domain: "data.cityofchicago.org",
    id: "ijzp-q8t2",
    name: "Chicago Crimes",
    lat: 41.8781,
    lng: -87.6298,
    radiusMiles: 25,
  },
  // Los Angeles — Crime Data
  {
    domain: "data.lacity.org",
    id: "2nrs-mtv8",
    name: "LA Crime Data",
    lat: 34.0522,
    lng: -118.2437,
    radiusMiles: 30,
  },
  // San Francisco — Police Incidents
  {
    domain: "data.sfgov.org",
    id: "wg3w-h783",
    name: "SF Police Incidents",
    lat: 37.7749,
    lng: -122.4194,
    radiusMiles: 15,
  },
  // NYC — NYPD Complaints (current year)
  {
    domain: "data.cityofnewyork.us",
    id: "5uac-w243",
    name: "NYC NYPD Complaints",
    lat: 40.7128,
    lng: -74.006,
    radiusMiles: 25,
  },
  // Dallas — Police Incidents
  {
    domain: "www.dallasopendata.com",
    id: "qv6i-rri7",
    name: "Dallas Police Incidents",
    lat: 32.7767,
    lng: -96.797,
    radiusMiles: 20,
  },
  // Kansas City — Crime Data
  {
    domain: "data.kcmo.org",
    id: "kbzx-7ehe",
    name: "KCPD Crime Data",
    lat: 39.0997,
    lng: -94.5786,
    radiusMiles: 20,
  },
  // Cincinnati — PDI Crime Incidents
  {
    domain: "data.cincinnati-oh.gov",
    id: "k59e-2pvf",
    name: "Cincinnati Crime Incidents",
    lat: 39.1031,
    lng: -84.512,
    radiusMiles: 15,
  },
  // Oakland — CrimeWatch
  {
    domain: "data.oaklandca.gov",
    id: "ym6k-rx7a",
    name: "Oakland CrimeWatch",
    lat: 37.8044,
    lng: -122.2712,
    radiusMiles: 12,
  },
  // Baton Rouge — Crime Incidents
  {
    domain: "data.brla.gov",
    id: "fabb-cnnu",
    name: "Baton Rouge Crime",
    lat: 30.4515,
    lng: -91.1871,
    radiusMiles: 15,
  },
];

// Column name patterns for detecting relevant fields across varied schemas
const DATE_PATTERNS = [
  /^date[_\s]?(of[_\s]?)?report/i,
  /^date[_\s]?(of[_\s]?)?occur/i,
  /^date[_\s]?from/i,
  /^incident[_\s]?date/i,
  /^incident[_\s]?datetime/i,
  /^reported[_\s]?date/i,
  /^occurred[_\s]?date/i,
  /^offense[_\s]?date/i,
  /^createddateutc/i,
  /^offensedateutc/i,
  /^report[_\s]?date/i,
  /^report[_\s]?datetime/i,
  /^rpt[_\s]?dt$/i,
  /^rpt[_\s]?date/i,
  /^cmplnt[_\s]?fr[_\s]?dt/i,
  /^date[_\s]?occ/i,
  /^date$/i,
];

const TYPE_PATTERNS = [
  /^offense$/i,
  /^offense[_\s]?type/i,
  /^offense[_\s]?desc/i,
  /^offense[_\s]?grouping/i,
  /^offense[_\s]?category/i,
  /^offense[_\s]?sub[_\s]?category/i,
  /^crime[_\s]?type/i,
  /^incident[_\s]?category/i,
  /^incident[_\s]?type/i,
  /^incident[_\s]?desc/i,
  /^category$/i,
  /^type$/i,
  /^ucr[_\s]?desc/i,
  /^ucr[_\s]?group/i,
  /^primary[_\s]?type/i,
  /^primary[_\s]?desc/i,
  /^_primary[_\s]?desc/i,
  /^crime[_\s]?category/i,
  /^charge[_\s]?desc/i,
  /^nibrs[_\s]?offense/i,
  /^crm[_\s]?cd[_\s]?desc/i,
  /^ofns[_\s]?desc/i,
  /^pd[_\s]?desc/i,
  /^law[_\s]?cat[_\s]?cd/i,
  /^description$/i,
];

const ADDRESS_PATTERNS = [
  /^address$/i,
  /^block[_\s]?address/i,
  /^street[_\s]?address/i,
  /^incident[_\s]?address/i,
  /^block$/i,
  /^hundred_block$/i,
  /^streetblock/i,
  /^streetname/i,
  /^street$/i,
  /^address_x$/i,
  /^location[_\s]?desc/i,
  /^location_description$/i,
];

const LAT_PATTERNS = [
  /^latitude$/i,
  /^lat$/i,
  /^latitude_x$/i,
  /^geo[_\s]?lat/i,
  /^mapped[_\s]?lat/i,
];

const LNG_PATTERNS = [
  /^longitude$/i,
  /^lng$/i,
  /^lon$/i,
  /^longitude_x$/i,
  /^geo[_\s]?lon/i,
  /^mapped[_\s]?lon/i,
];

// Columns that contain point geometry (Socrata "Location" or "Point" datatype)
// IMPORTANT: These are matched by name but MUST also be verified against the column
// datatype from the catalog. Many datasets have a "location" column that is plain text.
const POINT_PATTERNS = [
  /^location$/i,
  /^geocoded[_\s]?column/i,
  /^point$/i,
  /^geo[_\s]?location/i,
  /^the[_\s]?geom$/i,
  /^coordinates$/i,
  /^mapping[_\s]?location$/i,
  /^location_1$/i,
  /^geomcoordinate$/i,
];

// Socrata datatypes that represent actual geo points (not text)
// Catalog API returns capitalized ("Point"), views API returns lowercase ("point")
const GEO_DATATYPES = new Set(["Point", "Location", "point", "location"]);

function matchColumn(
  columns: string[],
  patterns: RegExp[]
): string | undefined {
  for (const pattern of patterns) {
    const match = columns.find((c) => pattern.test(c));
    if (match) return match;
  }
  return undefined;
}

// Match a point/location column only if its datatype is an actual geo type
function matchPointColumn(
  columns: string[],
  datatypes: string[]
): string | undefined {
  for (const pattern of POINT_PATTERNS) {
    const idx = columns.findIndex((c) => pattern.test(c));
    if (idx !== -1 && datatypes[idx] && GEO_DATATYPES.has(datatypes[idx])) {
      return columns[idx];
    }
  }
  return undefined;
}

// Check if a dataset has the required columns for point-level incident data
function hasRequiredColumns(columns: string[], datatypes: string[]): boolean {
  const hasDate = matchColumn(columns, DATE_PATTERNS) !== undefined;
  const hasType = matchColumn(columns, TYPE_PATTERNS) !== undefined;
  const hasLat = matchColumn(columns, LAT_PATTERNS) !== undefined;
  const hasLng = matchColumn(columns, LNG_PATTERNS) !== undefined;
  const hasPoint = matchPointColumn(columns, datatypes) !== undefined;
  const hasGeo = (hasLat && hasLng) || hasPoint;

  return hasDate && hasType && hasGeo;
}

interface DatasetInfo {
  domain: string;
  id: string;
  name: string;
  columns: string[];
  datatypes: string[];
}

// Haversine distance in miles
function haversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3959;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Discover datasets from the curated registry that cover the given coordinates
function findKnownDatasets(lat: number, lng: number): DatasetInfo[] {
  return KNOWN_DATASETS.filter(
    (d) => haversineDistance(lat, lng, d.lat, d.lng) <= d.radiusMiles
  ).map((d) => ({
    domain: d.domain,
    id: d.id,
    name: d.name,
    columns: [], // Will be discovered at query time via metadata endpoint
    datatypes: [],
  }));
}

// Fetch column metadata for a dataset so we know how to query it
async function fetchDatasetMetadata(
  dataset: DatasetInfo
): Promise<DatasetInfo | null> {
  // If we already have columns (from catalog search), return as-is
  if (dataset.columns.length > 0) return dataset;

  const url = `https://${dataset.domain}/api/views/${dataset.id}.json`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) return null;

  const meta = (await response.json()) as {
    columns?: Array<{
      fieldName: string;
      dataTypeName: string;
    }>;
  };

  if (!meta.columns?.length) return null;

  return {
    ...dataset,
    columns: meta.columns.map((c) => c.fieldName),
    datatypes: meta.columns.map((c) => c.dataTypeName),
  };
}

// Discover crime datasets near given coordinates using the Socrata catalog API
async function discoverCatalogDatasets(): Promise<DatasetInfo[]> {
  const searches = ["crime incidents", "police incidents", "crime reports"];

  // Run searches in parallel for broader coverage
  const results = await Promise.allSettled(
    searches.map(async (q) => {
      const params = new URLSearchParams({
        q,
        categories: "Public Safety",
        only: "datasets",
        limit: "15",
      });

      const url = `https://api.us.socrata.com/api/catalog/v1?${params}`;
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "neighborhood-mcp/1.0",
        },
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) return [];
      const data = (await response.json()) as CatalogResponse;
      return data.results ?? [];
    })
  );

  // Combine and deduplicate by dataset ID
  const seen = new Set<string>();
  const datasets: DatasetInfo[] = [];

  for (const result of results) {
    if (result.status !== "fulfilled") continue;
    for (const r of result.value) {
      if (seen.has(r.resource.id)) continue;
      seen.add(r.resource.id);

      if (!r.resource.columns_field_name?.length) continue;
      if (
        !hasRequiredColumns(
          r.resource.columns_field_name,
          r.resource.columns_datatype ?? []
        )
      )
        continue;

      datasets.push({
        domain: r.metadata.domain,
        id: r.resource.id,
        name: r.resource.name,
        columns: r.resource.columns_field_name,
        datatypes: r.resource.columns_datatype ?? [],
      });
    }
  }

  return datasets;
}

function parseDate(value: unknown): string | null {
  if (!value) return null;
  const str = String(value);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function extractCoords(
  record: SocrataRecord,
  latCol: string | undefined,
  lngCol: string | undefined,
  pointCol: string | undefined
): { lat: number; lng: number } | null {
  // Try explicit lat/lng columns first
  if (latCol && lngCol) {
    const lat = Number(record[latCol]);
    const lng = Number(record[lngCol]);
    if (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat !== 0 &&
      lng !== 0
    ) {
      return { lat, lng };
    }
  }

  // Try point/location column (Socrata "Location" type is an object with latitude/longitude)
  if (pointCol) {
    const point = record[pointCol];
    if (point && typeof point === "object") {
      const p = point as Record<string, unknown>;
      // Standard Socrata location object: { latitude: "39.1", longitude: "-84.5" }
      const lat = Number(p.latitude ?? p.lat);
      const lng = Number(p.longitude ?? p.lng ?? p.lon);
      if (
        Number.isFinite(lat) &&
        Number.isFinite(lng) &&
        lat !== 0 &&
        lng !== 0
      ) {
        return { lat, lng };
      }
      // Some have coordinates array: { type: "Point", coordinates: [lng, lat] }
      if (Array.isArray(p.coordinates) && p.coordinates.length >= 2) {
        const cLng = Number(p.coordinates[0]);
        const cLat = Number(p.coordinates[1]);
        if (
          Number.isFinite(cLat) &&
          Number.isFinite(cLng) &&
          cLat !== 0 &&
          cLng !== 0
        ) {
          return { lat: cLat, lng: cLng };
        }
      }
    }
  }

  return null;
}

// Check if a column is stored as text in the catalog metadata
function isTextColumn(dataset: DatasetInfo, colName: string): boolean {
  const idx = dataset.columns.indexOf(colName);
  if (idx === -1) return false;
  const dtype = dataset.datatypes[idx];
  return dtype === "Text" || dtype === "text";
}

async function queryDataset(
  dataset: DatasetInfo,
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number },
  days: number
): Promise<RawIncident[]> {
  const { domain, id, columns, datatypes } = dataset;

  const latCol = matchColumn(columns, LAT_PATTERNS);
  const lngCol = matchColumn(columns, LNG_PATTERNS);
  const pointCol = matchPointColumn(columns, datatypes);
  const dateCol = matchColumn(columns, DATE_PATTERNS);
  const typeCol = matchColumn(columns, TYPE_PATTERNS);
  const addressCol = matchColumn(columns, ADDRESS_PATTERNS);

  if (!dateCol || !typeCol) return [];
  if (!latCol && !lngCol && !pointCol) return [];

  // Build query with geo filter and date filter
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().slice(0, 19);

  const whereClauses: string[] = [];

  // Date filter
  whereClauses.push(`${dateCol} > '${cutoffStr}'`);

  // Geo filter — prefer within_circle on verified point column, fall back to bbox on lat/lng
  if (pointCol) {
    // within_circle(column, lat, lng, radius_meters)
    const latSpan = bbox.maxLat - bbox.minLat;
    const lngSpan = bbox.maxLng - bbox.minLng;
    const centerLat = (bbox.minLat + bbox.maxLat) / 2;
    const centerLng = (bbox.minLng + bbox.maxLng) / 2;
    // Convert degree span to meters (rough: 1 degree lat ~ 111km)
    const radiusMeters = (Math.max(latSpan, lngSpan) * 111000) / 2;
    whereClauses.push(
      `within_circle(${pointCol}, ${centerLat}, ${centerLng}, ${radiusMeters})`
    );
  } else if (latCol && lngCol) {
    // Text-typed lat/lng columns can't be compared numerically in SoQL —
    // skip server-side geo filter and do client-side filtering instead
    if (!isTextColumn(dataset, latCol) && !isTextColumn(dataset, lngCol)) {
      whereClauses.push(
        `${latCol} > ${bbox.minLat} AND ${latCol} < ${bbox.maxLat} AND ${lngCol} > ${bbox.minLng} AND ${lngCol} < ${bbox.maxLng}`
      );
    }
    // If text-typed, we'll filter client-side after extractCoords
  }

  const params = new URLSearchParams({
    $where: whereClauses.join(" AND "),
    $limit: "200",
    $order: `${dateCol} DESC`,
  });

  const url = `https://${domain}/resource/${id}.json?${params}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "neighborhood-mcp/1.0",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!response.ok) {
    // Auth, rate limit, removed dataset, or malformed query errors — skip silently
    // 400 = query incompatibility (schema changes, missing columns, etc.)
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 429
    ) {
      return [];
    }
    throw new Error(
      `Socrata ${dataset.name} (${domain}) error: HTTP ${response.status}`
    );
  }

  const records = (await response.json()) as SocrataRecord[];
  if (!Array.isArray(records) || records.length === 0) return [];

  const prefix = `soc-${id}`;
  const results: RawIncident[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (!record) continue;

    const coords = extractCoords(record, latCol, lngCol, pointCol);
    if (!coords) continue;

    // Client-side bbox filter for records that weren't geo-filtered server-side
    if (
      coords.lat < bbox.minLat ||
      coords.lat > bbox.maxLat ||
      coords.lng < bbox.minLng ||
      coords.lng > bbox.maxLng
    ) {
      continue;
    }

    const date = parseDate(record[dateCol]);
    if (!date) continue;

    const type = record[typeCol] ? String(record[typeCol]).trim() : "Other";
    const address =
      addressCol && record[addressCol]
        ? String(record[addressCol]).trim()
        : "Unknown";

    results.push({
      source: "socrata",
      id: `${prefix}-${i}`,
      type,
      description: `${type} at ${address}`,
      date,
      address,
      lat: coords.lat,
      lng: coords.lng,
    });
  }

  return results;
}

export async function fetchSocrata(
  lat: number,
  lng: number,
  radiusMiles: number,
  days: number
): Promise<RawIncident[]> {
  const bbox = buildBoundingBox(lat, lng, radiusMiles);

  // Two-tier discovery: curated registry (fast, location-aware) + catalog search (broad)
  const knownDatasets = findKnownDatasets(lat, lng);

  // Run catalog discovery in parallel with metadata fetches for known datasets
  const [catalogDatasets, ...knownWithMeta] = await Promise.all([
    discoverCatalogDatasets().catch(() => [] as DatasetInfo[]),
    ...knownDatasets.map((ds) => fetchDatasetMetadata(ds)),
  ]);

  // Combine: known datasets first (higher quality), then catalog results
  const seen = new Set<string>();
  const allDatasets: DatasetInfo[] = [];

  for (const ds of knownWithMeta) {
    if (!ds) continue;
    seen.add(ds.id);
    allDatasets.push(ds);
  }

  for (const ds of catalogDatasets) {
    if (seen.has(ds.id)) continue;
    seen.add(ds.id);
    allDatasets.push(ds);
  }

  if (allDatasets.length === 0) {
    return []; // No datasets found — not an error
  }

  // Query up to 8 datasets in parallel
  const toQuery = allDatasets.slice(0, 8);

  const results = await Promise.allSettled(
    toQuery.map((ds) => queryDataset(ds, bbox, days))
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

  // Only throw if ALL datasets failed AND we had known datasets to try
  // (catalog-only failures are expected for locations without coverage)
  if (incidents.length === 0 && errors.length > 0 && knownDatasets.length > 0) {
    throw new Error(
      `All Socrata datasets failed: ${errors.slice(0, 3).join("; ")}`
    );
  }

  return incidents;
}
