export type IncidentSource = "arcgis" | "socrata" | "spotcrime";

export type IncidentSeverity = "low" | "medium" | "high";

export interface IncidentProperties {
  id: string;
  source: IncidentSource;
  type: string;
  description: string;
  date: string; // ISO 8601
  address: string;
  url?: string;
  severity?: IncidentSeverity;
}

export interface IncidentFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number]; // [lng, lat]
  };
  properties: IncidentProperties;
}

export interface IncidentFeatureCollection {
  type: "FeatureCollection";
  features: IncidentFeature[];
  metadata: {
    zipCode: string;
    radius: number;
    days: number;
    generatedAt: string;
    totalCount: number;
    countBySource: Record<IncidentSource, number>;
    countByType: Record<string, number>;
  };
  sourceErrors: SourceError[];
}

export interface SourceError {
  source: IncidentSource | string;
  error: string;
  timestamp: string;
}

export interface Coordinates {
  lat: number;
  lng: number;
  boundingBox?: {
    minLat: number;
    maxLat: number;
    minLng: number;
    maxLng: number;
  };
  displayName?: string;
}

export interface SourceStatus {
  name: IncidentSource;
  label: string;
  online: boolean;
  coverage: string;
  updateFrequency: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  hasApiKey: boolean;
  lastChecked: string;
  error?: string;
}

export interface CrimeStats {
  zipCode: string;
  days: number;
  totalIncidents: number;
  byType: Record<string, number>;
  bySource: Record<string, number>;
  bySeverity: Record<IncidentSeverity, number>;
  topTypes: Array<{ type: string; count: number; percentage: number }>;
  trend: "increasing" | "decreasing" | "stable" | "unknown";
  generatedAt: string;
  sourceErrors: SourceError[];
}

export interface NewsAlert {
  title: string;
  url: string;
  publishedAt: string;
  source: string;
  description: string;
  snippet: string;
}

export interface AlertsResult {
  zipCode: string;
  alerts: NewsAlert[];
  totalCount: number;
  generatedAt: string;
  sourceErrors: SourceError[];
}

export interface RawIncident {
  source: IncidentSource;
  id: string;
  type: string;
  description: string;
  date: string;
  address: string;
  lat: number;
  lng: number;
  url?: string;
  severity?: IncidentSeverity;
}
