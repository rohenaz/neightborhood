import { App } from "@modelcontextprotocol/ext-apps";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const COLORS = {
  high: "#ef4444",
  medium: "#f97316",
  low: "#22c55e",
  theft: "#3b82f6",
  assault: "#ef4444",
  vehicle: "#a855f7",
  drugs: "#ec4899",
  vandalism: "#f59e0b",
  sexOffender: "#7c3aed",
  news: "#64748b",
  other: "#06b6d4",
  background: "#09090b",
  accent: "#3b82f6",
} as const;

function pinColor(type: string, severity: string | undefined): string {
  if (severity === "high") return COLORS.high;
  if (severity === "medium") return COLORS.medium;
  const lower = type.toLowerCase();
  if (lower.includes("theft") || lower.includes("burglary"))
    return COLORS.theft;
  if (lower.includes("assault") || lower.includes("robbery"))
    return COLORS.assault;
  if (lower.includes("auto") || lower.includes("vehicle"))
    return COLORS.vehicle;
  if (lower.includes("drug") || lower.includes("narcotic")) return COLORS.drugs;
  if (lower.includes("vandal")) return COLORS.vandalism;
  if (lower.includes("sex") || lower.includes("offender"))
    return COLORS.sexOffender;
  if (lower.includes("news") || lower.includes("alert")) return COLORS.news;
  return COLORS.other;
}

function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function getStyleUrl(mapboxToken?: string): string {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (mapboxToken) {
    const style = dark ? "dark-v11" : "light-v11";
    return `https://api.mapbox.com/styles/v1/mapbox/${style}?access_token=${mapboxToken}`;
  }
  const style = dark ? "dark-matter-gl-style" : "positron-gl-style";
  return `https://basemaps.cartocdn.com/gl/${style}/style.json`;
}

/**
 * Generate a GeoJSON Polygon approximating a circle.
 * center: [lng, lat], radiusMiles in miles.
 */
function circlePolygon(
  center: [number, number],
  radiusMiles: number,
  points = 64
): GeoJSON.Feature<GeoJSON.Polygon> {
  const km = radiusMiles * 1.60934;
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = km * Math.cos(angle);
    const dy = km * Math.sin(angle);
    const lat = center[1] + dy / 111.32;
    const lng =
      center[0] + dx / (111.32 * Math.cos((center[1] * Math.PI) / 180));
    coords.push([lng, lat]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

interface Feature {
  geometry: { coordinates: [number, number] };
  properties: {
    type: string;
    severity?: string;
    description: string;
    address: string;
    date: string;
    source: string;
    url?: string;
  };
}

interface SourceInfo {
  name: string;
  label: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  signupUrl?: string;
  hasApiKey: boolean;
}

interface ScannerFeed {
  id: string;
  name: string;
  county: string;
  listeners?: number;
  status?: "online" | "offline";
  url: string;
}

interface MapData {
  zipCode: string;
  lat: number;
  lng: number;
  radius: number;
  days: number;
  features: Feature[];
  sourceErrors?: Array<{ source: string; error: string }>;
  sources?: SourceInfo[];
  scannerFeeds?: ScannerFeed[];
  mapboxToken?: string;
}

interface GeoJsonFeatureProps {
  color: string;
  title: string;
  type: string;
  date: string;
  source: string;
  description: string;
  severity: string;
  url: string;
  address: string;
}

let currentMap: maplibregl.Map | null = null;
let currentRadius = 5;
let currentDays = 30;

/**
 * Build GeoJSON features array from incident features, enriched with display properties.
 */
function buildGeoJsonFeatures(
  features: Feature[]
): GeoJSON.Feature<GeoJSON.Point, GeoJsonFeatureProps>[] {
  return features.map((f) => {
    const [lng, lat] = f.geometry.coordinates;
    const p = f.properties;
    const color = pinColor(p.type, p.severity);
    return {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        color,
        title: p.type,
        type: p.type,
        date: p.date,
        source: p.source,
        description: p.description,
        severity: p.severity ?? "",
        url: p.url ?? "",
        address: p.address,
      },
    };
  });
}

/**
 * Add all map data sources and layers. Called on initial load and after style swap.
 */
function addDataLayers(
  map: maplibregl.Map,
  geoJsonFeatures: GeoJSON.Feature<GeoJSON.Point, GeoJsonFeatureProps>[],
  lat: number,
  lng: number,
  radius: number,
  zipCode: string
): void {
  // Search area circle (fill + outline)
  const circleFeature = circlePolygon([lng, lat], radius);
  map.addSource("search-area", {
    type: "geojson",
    data: circleFeature,
  });
  map.addLayer({
    id: "search-area-fill",
    type: "fill",
    source: "search-area",
    paint: {
      "fill-color": COLORS.accent,
      "fill-opacity": 0.04,
    },
  });
  map.addLayer({
    id: "search-area-line",
    type: "line",
    source: "search-area",
    paint: {
      "line-color": COLORS.accent,
      "line-width": 1,
      "line-dasharray": [6, 4],
    },
  });

  // Center pin marker
  map.addSource("center-pin", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: { zipCode },
    },
  });
  map.addLayer({
    id: "center-pin",
    type: "circle",
    source: "center-pin",
    paint: {
      "circle-radius": 8,
      "circle-color": COLORS.accent,
      "circle-stroke-width": 2,
      "circle-stroke-color": COLORS.background,
      "circle-opacity": 0.6,
    },
  });

  // Incident clustering source
  map.addSource("incidents", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: geoJsonFeatures,
    },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
  });

  // Cluster circles
  map.addLayer({
    id: "clusters",
    type: "circle",
    source: "incidents",
    filter: ["has", "point_count"],
    paint: {
      "circle-color": [
        "step",
        ["get", "point_count"],
        "#51bbd6",
        10,
        "#f1f075",
        50,
        "#f28cb1",
      ],
      "circle-radius": [
        "step",
        ["get", "point_count"],
        15,
        10,
        20,
        50,
        25,
      ],
    },
  });

  // Cluster count labels
  map.addLayer({
    id: "cluster-count",
    type: "symbol",
    source: "incidents",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count_abbreviated"],
      "text-size": 12,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: {
      "text-color": "#fff",
    },
  });

  // Individual (unclustered) points
  map.addLayer({
    id: "unclustered-point",
    type: "circle",
    source: "incidents",
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": ["get", "color"],
      "circle-radius": 6,
      "circle-stroke-width": 1,
      "circle-stroke-color": "#fff",
    },
  });
}

/**
 * Attach map interaction handlers (click cluster to expand, click point for popup).
 * Must be called once after layers are created; handlers survive style swaps because
 * we re-call addDataLayers which re-creates the layers, then this function re-binds.
 */
function attachMapHandlers(
  map: maplibregl.Map,
  geoJsonFeatures: GeoJSON.Feature<GeoJSON.Point, GeoJsonFeatureProps>[],
  zipCode: string
): void {
  // Expand cluster on click
  map.on("click", "clusters", (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: ["clusters"],
    });
    if (!features.length) return;
    const clusterId = features[0].properties.cluster_id as number;
    const source = map.getSource("incidents") as maplibregl.GeoJSONSource;
    source.getClusterExpansionZoom(clusterId).then((zoom) => {
      const geometry = features[0].geometry as GeoJSON.Point;
      map.easeTo({
        center: geometry.coordinates as [number, number],
        zoom,
      });
    });
  });

  // Popup on unclustered point click
  map.on("click", "unclustered-point", (e) => {
    const feature = e.features?.[0];
    if (!feature) return;
    const p = feature.properties as GeoJsonFeatureProps;
    const geometry = feature.geometry as GeoJSON.Point;
    const coords = geometry.coordinates as [number, number];

    const date = new Date(p.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const linkHtml = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" class="popup-link">View source &rarr;</a>`
      : "";
    const severityBadge = p.severity
      ? `<span class="badge badge-${esc(p.severity)}">${esc(p.severity)}</span>`
      : "";

    const html = `
      <div class="popup">
        <div class="popup-header">
          <span class="popup-dot" style="background:${esc(p.color)}"></span>
          <strong>${esc(p.type)}</strong>
          ${severityBadge}
        </div>
        <p class="popup-desc">${esc(p.description)}</p>
        <div class="popup-meta">
          <span>${esc(p.address)}</span>
          <span>${esc(date)}</span>
          <span class="popup-source">${esc(p.source)}</span>
        </div>
        ${linkHtml}
      </div>
    `;

    new maplibregl.Popup({ maxWidth: "300px", anchor: "bottom" })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);
  });

  // Popup on center pin click
  map.on("click", "center-pin", () => {
    const center = map.getCenter();
    new maplibregl.Popup({ anchor: "bottom" })
      .setLngLat([center.lng, center.lat])
      .setHTML(`<div class="popup"><strong>ZIP ${esc(zipCode)}</strong></div>`)
      .addTo(map);
  });

  // Pointer cursor on interactive layers
  for (const layer of ["clusters", "unclustered-point", "center-pin"]) {
    map.on("mouseenter", layer, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function renderMap(data: MapData): void {
  const loadingEl = document.getElementById("loading");
  const headerEl = document.getElementById("header");
  const mapEl = document.getElementById("map");
  const legendEl = document.getElementById("legend");

  if (loadingEl) loadingEl.style.display = "none";
  if (headerEl) headerEl.style.display = "flex";
  if (mapEl) mapEl.style.display = "block";
  if (legendEl) legendEl.style.display = "block";

  // Destroy previous map if re-rendering
  if (currentMap) {
    currentMap.remove();
    currentMap = null;
  }

  const { zipCode, lat, lng, radius, days, features, sourceErrors, sources } =
    data;
  currentRadius = radius;
  currentDays = days;
  const sourceCount = new Set(features.map((f) => f.properties.source)).size;

  const zipEl = document.getElementById("zip") as HTMLElement | null;
  const metaEl = document.getElementById("meta");
  if (zipEl) zipEl.textContent = zipCode;
  if (metaEl) {
    metaEl.innerHTML = `
      <span><span class="stat">${features.length}</span> incidents</span>
      <span><span class="stat">${sourceCount}</span> sources</span>
      <span><span class="stat">${radius}</span>mi radius</span>
      <span>last <span class="stat">${days}</span> days</span>
    `;
  }

  // Error badges in header
  if (sourceErrors && sourceErrors.length > 0) {
    const errorsEl = document.getElementById("header-errors");
    if (errorsEl) {
      errorsEl.innerHTML = sourceErrors
        .map(
          (e) =>
            `<span class="header-error-badge">${esc(e.source)} offline</span>`
        )
        .join("");
    }
  }

  // Sources indicator
  if (sources && sources.length > 0) {
    const active = sources.filter((s) => s.hasApiKey).length;
    const total = sources.length;
    const indicatorEl = document.getElementById("sources-indicator");
    if (indicatorEl) {
      const allActive = active === total;
      indicatorEl.className = `sources-indicator ${allActive ? "sources-all" : "sources-partial"}`;
      indicatorEl.textContent = `${active}/${total}`;
      indicatorEl.title = "Click to see API key configuration";

      const rows = sources
        .map((s) => {
          const dot = s.hasApiKey ? "sources-dot-on" : "sources-dot-off";
          const envLine =
            s.requiresApiKey && s.apiKeyEnvVar
              ? `<code class="sources-env">${esc(s.apiKeyEnvVar)}</code>`
              : '<span class="sources-env sources-no-key">no key needed</span>';
          const linkHtml =
            !s.hasApiKey && s.signupUrl
              ? ` <a href="${esc(s.signupUrl)}" target="_blank" rel="noopener noreferrer" class="sources-signup">get key</a>`
              : "";
          return `<div class="sources-row"><span class="sources-dot ${dot}"></span><span class="sources-name">${esc(s.label)}</span>${envLine}${linkHtml}</div>`;
        })
        .join("");

      const popover = document.getElementById("sources-popover");
      if (popover) {
        popover.innerHTML = `<div class="sources-popover-title">Data Sources</div>${rows}`;
      }

      indicatorEl.addEventListener("click", (e) => {
        e.stopPropagation();
        if (popover) popover.classList.toggle("sources-popover-open");
      });

      document.addEventListener("click", () => {
        if (popover) popover.classList.remove("sources-popover-open");
      });
    }
  }

  // Scanner feeds indicator
  const scannerFeeds = data.scannerFeeds;
  const scannerIndicator = document.getElementById("scanner-indicator");
  const scannerPopover = document.getElementById("scanner-popover");

  if (scannerIndicator && scannerPopover) {
    if (scannerFeeds && scannerFeeds.length > 0) {
      const onlineCount = scannerFeeds.filter(
        (f) => f.status === "online"
      ).length;
      scannerIndicator.textContent = `${onlineCount}/${scannerFeeds.length}`;
      scannerIndicator.className = `scanner-indicator ${onlineCount > 0 ? "scanner-active" : "scanner-inactive"}`;
      scannerIndicator.title = "Police scanner feeds";

      const rows = scannerFeeds
        .map((f) => {
          const dot =
            f.status === "online" ? "scanner-dot-on" : "scanner-dot-off";
          const listenersHtml =
            f.listeners !== undefined
              ? `<span class="scanner-listeners">${f.listeners}</span>`
              : "";
          return `<div class="scanner-row">
            <span class="scanner-dot ${dot}"></span>
            <a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer" class="scanner-name">${esc(f.name)}</a>
            ${listenersHtml}
          </div>`;
        })
        .join("");

      scannerPopover.innerHTML = `<div class="scanner-popover-title">Scanner Feeds</div>${rows}`;

      scannerIndicator.addEventListener("click", (e) => {
        e.stopPropagation();
        scannerPopover.classList.toggle("scanner-popover-open");
        const sourcesPopover = document.getElementById("sources-popover");
        if (sourcesPopover)
          sourcesPopover.classList.remove("sources-popover-open");
      });

      document.addEventListener("click", () => {
        scannerPopover.classList.remove("scanner-popover-open");
      });
    } else {
      scannerIndicator.textContent = "0";
      scannerIndicator.className = "scanner-indicator scanner-inactive";
      scannerIndicator.title = "No scanner feeds found";

      scannerPopover.innerHTML = `<div class="scanner-popover-title">Scanner Feeds</div><div class="scanner-empty">No scanner feeds found for this area</div>`;

      scannerIndicator.addEventListener("click", (e) => {
        e.stopPropagation();
        scannerPopover.classList.toggle("scanner-popover-open");
      });

      document.addEventListener("click", () => {
        scannerPopover.classList.remove("scanner-popover-open");
      });
    }
  }

  // Build enriched GeoJSON features
  const geoJsonFeatures = buildGeoJsonFeatures(features);

  // Build legend from unique types before the map loads
  const typeColors = new Map<string, string>();
  for (const f of features) {
    const p = f.properties;
    if (!typeColors.has(p.type)) {
      typeColors.set(p.type, pinColor(p.type, p.severity));
    }
  }
  const legendItems = document.getElementById("legend-items");
  if (legendItems) {
    const entries = Array.from(typeColors.entries()).slice(0, 12);
    if (entries.length === 0) {
      legendItems.innerHTML =
        '<div class="legend-item" style="color:var(--muted)">No incidents found</div>';
    } else {
      legendItems.innerHTML = entries
        .map(
          ([type, color]) =>
            `<div class="legend-item">
              <span class="legend-dot" style="background:${color}"></span>
              <span>${esc(type)}</span>
            </div>`
        )
        .join("\n");
    }
  }

  // Initialize MapLibre map
  const map = new maplibregl.Map({
    container: "map",
    style: getStyleUrl(data.mapboxToken),
    center: [lng, lat],
    zoom: 13,
    attributionControl: false,
  });
  currentMap = map;

  map.addControl(new maplibregl.NavigationControl(), "top-right");

  map.on("load", () => {
    addDataLayers(map, geoJsonFeatures, lat, lng, radius, zipCode);
    attachMapHandlers(map, geoJsonFeatures, zipCode);
  });

  // Theme switching: swap style and re-add all sources/layers
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    map.setStyle(getStyleUrl(data.mapboxToken));
    map.once("style.load", () => {
      addDataLayers(map, geoJsonFeatures, lat, lng, radius, zipCode);
      attachMapHandlers(map, geoJsonFeatures, zipCode);
    });
  });
}

// Connect to the MCP host and receive tool result data.
// Handlers MUST be registered before connect() to avoid missing notifications.
const app = new App({ name: "neighborhood", version: "1.0.0" });

app.ontoolresult = (params) => {
  const data = params.structuredContent as MapData | undefined;
  if (data) {
    renderMap(data);
    app.sendSizeChanged({ height: 600 });
  }
};

app.connect().then(() => {
  app.sendSizeChanged({ height: 600 });
});

// Zip code editing
const zipDisplay = document.getElementById("zip") as HTMLElement;
const zipForm = document.getElementById("zip-form") as HTMLFormElement;
const zipInput = document.getElementById("zip-input") as HTMLInputElement;

function showZipEditor() {
  zipInput.value = zipDisplay.textContent ?? "";
  zipDisplay.style.display = "none";
  zipForm.style.display = "block";
  zipInput.focus();
  zipInput.select();
}

function hideZipEditor() {
  zipForm.style.display = "none";
  zipDisplay.style.display = "block";
}

async function submitZip(newZip: string) {
  const trimmed = newZip.trim();
  if (!/^\d{5}$/.test(trimmed)) {
    hideZipEditor();
    return;
  }
  if (trimmed === zipDisplay.textContent) {
    hideZipEditor();
    return;
  }

  hideZipEditor();
  zipDisplay.textContent = trimmed;

  const metaEl = document.getElementById("meta");
  if (metaEl)
    metaEl.innerHTML = '<span style="color:var(--muted)">Loading...</span>';

  const result = await app.callServerTool({
    name: "get_map_html",
    arguments: { zipCode: trimmed, radius: currentRadius, days: currentDays },
  });

  const data = result.structuredContent as MapData | undefined;
  if (data) {
    renderMap(data);
  }
}

zipDisplay.addEventListener("click", showZipEditor);
zipForm.addEventListener("submit", (e) => {
  e.preventDefault();
  submitZip(zipInput.value);
});
zipInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideZipEditor();
});
zipInput.addEventListener("blur", () => {
  submitZip(zipInput.value);
});
