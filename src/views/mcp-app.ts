import { App } from "@modelcontextprotocol/ext-apps";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ── Color palette ────────────────────────────────────────────────────────────
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

// ── XSS helper ───────────────────────────────────────────────────────────────
function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ── Map style ────────────────────────────────────────────────────────────────
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

// ── Types ─────────────────────────────────────────────────────────────────────
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

interface DataTablePayload {
  zipCode: string;
  days: number;
  totalIncidents: number;
  trend: "increasing" | "decreasing" | "stable" | "unknown";
  bySeverity: { high: number; medium: number; low: number };
  topTypes: Array<{ type: string; count: number; percentage: number }>;
  bySource: Record<string, number>;
  alerts: Array<{
    title: string;
    url: string;
    publishedAt: string;
    source: string;
    description: string;
    snippet: string;
  }>;
  sourceErrors: Array<{ source: string; error: string; timestamp: string }>;
  generatedAt: string;
}

// ── Link copy helper ─────────────────────────────────────────────────────────
// srcdoc iframes are sandboxed without allow-popups, so target="_blank" silently
// fails. Copy the URL instead and show a brief toast.

let _hideTimer: ReturnType<typeof setTimeout> | null = null;

function showToast(message: string) {
  const toast = document.getElementById("link-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("link-toast-visible");
  if (_hideTimer !== null) clearTimeout(_hideTimer);
  _hideTimer = setTimeout(() => {
    toast.classList.remove("link-toast-visible");
    _hideTimer = null;
  }, 2000);
}

function copyLink(href: string): void {
  // Clipboard API is blocked in sandboxed srcdoc iframes.
  // Use execCommand fallback which works in more restrictive contexts.
  const ta = document.createElement("textarea");
  ta.value = href;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
    showToast("Link copied");
  } catch {
    showToast(href);
  }
  document.body.removeChild(ta);
}

// Global interceptor for links outside MapLibre popups (data panel, etc.)
document.addEventListener("click", (e) => {
  const target = (e.target as Element).closest("a[href]") as HTMLAnchorElement | null;
  if (!target) return;
  const href = target.getAttribute("href") ?? "";
  if (!href.startsWith("http")) return;
  e.preventDefault();
  copyLink(href);
});

// ── Map state ─────────────────────────────────────────────────────────────────
let currentMap: maplibregl.Map | null = null;
let currentRadius = 5;
let currentDays = 30;
let currentZip = "";

// ── Data panel state ──────────────────────────────────────────────────────────
let dataActiveTab: "stats" | "news" = "stats";
let dataFilterText = "";
let dataSortCol = "count";
let dataSortDir: "asc" | "desc" = "desc";
let dataCurrentPage = 0;
const DATA_PAGE_SIZE = 25;
let currentDataPayload: DataTablePayload | null = null;
let dataFetched = false;

// ── View tab state ────────────────────────────────────────────────────────────
type ViewTab = "map" | "data";
let activeViewTab: ViewTab = "map";

// ── GeoJSON helpers ───────────────────────────────────────────────────────────
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

function addDataLayers(
  map: maplibregl.Map,
  geoJsonFeatures: GeoJSON.Feature<GeoJSON.Point, GeoJsonFeatureProps>[],
  lat: number,
  lng: number,
  radius: number,
  zipCode: string
): void {
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

function attachMapHandlers(
  map: maplibregl.Map,
  geoJsonFeatures: GeoJSON.Feature<GeoJSON.Point, GeoJsonFeatureProps>[],
  zipCode: string
): void {
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

    const popup = new maplibregl.Popup({ maxWidth: "300px", anchor: "bottom" })
      .setLngLat(coords)
      .setHTML(html)
      .addTo(map);

    // Attach click handlers directly — document-level delegation doesn't
    // reliably reach links inside MapLibre popup DOM.
    const popupEl = popup.getElement();
    if (popupEl) {
      for (const link of popupEl.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        link.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          copyLink(link.getAttribute("href") ?? "");
        });
      }
    }
  });

  map.on("click", "center-pin", () => {
    const center = map.getCenter();
    new maplibregl.Popup({ anchor: "bottom" })
      .setLngLat([center.lng, center.lat])
      .setHTML(`<div class="popup"><strong>ZIP ${esc(zipCode)}</strong></div>`)
      .addTo(map);
  });

  for (const layer of ["clusters", "unclustered-point", "center-pin"]) {
    map.on("mouseenter", layer, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layer, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

// ── Map render ────────────────────────────────────────────────────────────────
function renderMap(data: MapData): void {
  const loadingEl = document.getElementById("loading");
  const headerEl = document.getElementById("header");
  const mapEl = document.getElementById("map");
  const legendEl = document.getElementById("legend");

  if (loadingEl) loadingEl.style.display = "none";
  if (headerEl) headerEl.style.display = "flex";

  // Only show map + legend if the map view tab is active
  if (activeViewTab === "map") {
    if (mapEl) mapEl.style.display = "block";
    if (legendEl) legendEl.style.display = "block";
  }

  if (currentMap) {
    currentMap.remove();
    currentMap = null;
  }

  const { zipCode, lat, lng, radius, days, features, sourceErrors, sources } =
    data;
  currentRadius = radius;
  currentDays = days;
  currentZip = zipCode;
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

  const geoJsonFeatures = buildGeoJsonFeatures(features);

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
    // Container may not be fully laid out when the map initializes inside
    // a srcdoc iframe — force a resize so MapLibre picks up correct dimensions.
    map.resize();
    addDataLayers(map, geoJsonFeatures, lat, lng, radius, zipCode);
    attachMapHandlers(map, geoJsonFeatures, zipCode);
  });

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", () => {
    map.setStyle(getStyleUrl(data.mapboxToken));
    map.once("style.load", () => {
      addDataLayers(map, geoJsonFeatures, lat, lng, radius, zipCode);
      attachMapHandlers(map, geoJsonFeatures, zipCode);
    });
  });
}

// ── Data panel rendering ──────────────────────────────────────────────────────

function trendBadgeHtml(trend: DataTablePayload["trend"]): string {
  const map: Record<DataTablePayload["trend"], { label: string; cls: string }> =
    {
      increasing: { label: "Increasing", cls: "badge-up" },
      decreasing: { label: "Decreasing", cls: "badge-down" },
      stable: { label: "Stable", cls: "badge-stable" },
      unknown: { label: "Unknown", cls: "badge-stable" },
    };
  const { label, cls } = map[trend];
  return `<span class="badge ${cls}">${label}</span>`;
}

function sortedTypes(
  rows: DataTablePayload["topTypes"]
): DataTablePayload["topTypes"] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (dataSortCol === "type") {
      cmp = a.type.localeCompare(b.type);
    } else if (dataSortCol === "percentage") {
      cmp = a.percentage - b.percentage;
    } else {
      cmp = a.count - b.count;
    }
    return dataSortDir === "asc" ? cmp : -cmp;
  });
}

function sortedNews(
  rows: DataTablePayload["alerts"]
): DataTablePayload["alerts"] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (dataSortCol === "title") {
      cmp = a.title.localeCompare(b.title);
    } else if (dataSortCol === "source") {
      cmp = a.source.localeCompare(b.source);
    } else {
      cmp =
        new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
    }
    return dataSortDir === "asc" ? cmp : -cmp;
  });
}

function sortClass(col: string): string {
  if (col !== dataSortCol) return "sortable";
  return `sortable ${dataSortDir === "asc" ? "sort-asc" : "sort-desc"}`;
}

function sortIndicator(col: string): string {
  if (col !== dataSortCol) return '<span class="sort-arrow">⇅</span>';
  return `<span class="sort-arrow">${dataSortDir === "asc" ? "▲" : "▼"}</span>`;
}

function filteredTypes(): DataTablePayload["topTypes"] {
  if (!currentDataPayload) return [];
  if (!dataFilterText) return currentDataPayload.topTypes;
  const q = dataFilterText.toLowerCase();
  return currentDataPayload.topTypes.filter((r) =>
    r.type.toLowerCase().includes(q)
  );
}

function filteredAlerts(): DataTablePayload["alerts"] {
  if (!currentDataPayload) return [];
  if (!dataFilterText) return currentDataPayload.alerts;
  const q = dataFilterText.toLowerCase();
  return currentDataPayload.alerts.filter(
    (r) =>
      r.title.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)
  );
}

function renderDataPagination(totalItems: number): void {
  const paginationEl = document.getElementById("dt-pagination");
  if (!paginationEl) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / DATA_PAGE_SIZE));
  const onFirst = dataCurrentPage === 0;
  const onLast = dataCurrentPage >= totalPages - 1;

  paginationEl.innerHTML = `
    <button id="dt-prev-page" class="pagination-btn" ${onFirst ? "disabled" : ""}>&larr; Prev</button>
    <span class="pagination-info">Page ${dataCurrentPage + 1} of ${totalPages}</span>
    <button id="dt-next-page" class="pagination-btn" ${onLast ? "disabled" : ""}>Next &rarr;</button>
  `;

  document.getElementById("dt-prev-page")?.addEventListener("click", () => {
    if (dataCurrentPage > 0) {
      dataCurrentPage--;
      renderActiveDataTable();
    }
  });

  document.getElementById("dt-next-page")?.addEventListener("click", () => {
    if (dataCurrentPage < totalPages - 1) {
      dataCurrentPage++;
      renderActiveDataTable();
    }
  });
}

function renderStatsTable(): void {
  if (!currentDataPayload) return;

  const headEl = document.getElementById("dt-stats-head");
  const bodyEl = document.getElementById("dt-stats-body");
  if (!headEl || !bodyEl) return;

  headEl.innerHTML = `
    <tr>
      <th class="${sortClass("type")}" data-col="type">Offense Type ${sortIndicator("type")}</th>
      <th class="${sortClass("count")}" data-col="count">Count ${sortIndicator("count")}</th>
      <th class="${sortClass("percentage")}" data-col="percentage">% of Total ${sortIndicator("percentage")}</th>
    </tr>
  `;

  for (const th of headEl.querySelectorAll<HTMLElement>(".sortable")) {
    th.addEventListener("click", () => {
      const col = th.dataset.col ?? "count";
      if (col === dataSortCol) {
        dataSortDir = dataSortDir === "asc" ? "desc" : "asc";
      } else {
        dataSortCol = col;
        dataSortDir = "desc";
      }
      dataCurrentPage = 0;
      renderStatsTable();
      renderDataPagination(filteredTypes().length);
    });
  }

  const filtered = filteredTypes();

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <tr><td colspan="3" class="empty-state">
        ${
          currentDataPayload.topTypes.length === 0
            ? "No crime statistics available. Set FBI_API_KEY for historical data."
            : "No results match your filter."
        }
      </td></tr>
    `;
    renderDataPagination(0);
    return;
  }

  const sorted = sortedTypes(filtered);
  const start = dataCurrentPage * DATA_PAGE_SIZE;
  const page = sorted.slice(start, start + DATA_PAGE_SIZE);

  bodyEl.innerHTML = page
    .map(
      (row) => `
      <tr>
        <td>${esc(row.type)}</td>
        <td class="num-cell">${row.count.toLocaleString()}</td>
        <td class="num-cell">${row.percentage.toFixed(1)}%</td>
      </tr>
    `
    )
    .join("");

  renderDataPagination(filtered.length);
}

function renderNewsTable(): void {
  if (!currentDataPayload) return;

  const headEl = document.getElementById("dt-news-head");
  const bodyEl = document.getElementById("dt-news-body");
  if (!headEl || !bodyEl) return;

  headEl.innerHTML = `
    <tr>
      <th class="${sortClass("date")}" data-col="date">Date ${sortIndicator("date")}</th>
      <th class="${sortClass("title")}" data-col="title">Title ${sortIndicator("title")}</th>
      <th class="${sortClass("source")}" data-col="source">Source ${sortIndicator("source")}</th>
    </tr>
  `;

  for (const th of headEl.querySelectorAll<HTMLElement>(".sortable")) {
    th.addEventListener("click", () => {
      const col = th.dataset.col ?? "date";
      if (col === dataSortCol) {
        dataSortDir = dataSortDir === "asc" ? "desc" : "asc";
      } else {
        dataSortCol = col;
        dataSortDir = "desc";
      }
      dataCurrentPage = 0;
      renderNewsTable();
      renderDataPagination(filteredAlerts().length);
    });
  }

  const filtered = filteredAlerts();

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <tr><td colspan="3" class="empty-state">
        ${
          currentDataPayload.alerts.length === 0
            ? "No crime news found for this area."
            : "No results match your filter."
        }
      </td></tr>
    `;
    renderDataPagination(0);
    return;
  }

  const sorted = sortedNews(filtered);
  const start = dataCurrentPage * DATA_PAGE_SIZE;
  const page = sorted.slice(start, start + DATA_PAGE_SIZE);

  bodyEl.innerHTML = page
    .map((row) => {
      const date = new Date(row.publishedAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
      return `
        <tr>
          <td class="date-cell">${esc(date)}</td>
          <td><a href="${esc(row.url)}" target="_blank" rel="noopener noreferrer" class="table-link">${esc(row.title)}</a></td>
          <td>${esc(row.source)}</td>
        </tr>
      `;
    })
    .join("");

  renderDataPagination(filtered.length);
}

function renderActiveDataTable(): void {
  if (dataActiveTab === "stats") {
    renderStatsTable();
  } else {
    renderNewsTable();
  }

  const countEl = document.getElementById("dt-toolbar-count");
  if (countEl && currentDataPayload) {
    const filtered =
      dataActiveTab === "stats"
        ? filteredTypes().length
        : filteredAlerts().length;
    const total =
      dataActiveTab === "stats"
        ? currentDataPayload.topTypes.length
        : currentDataPayload.alerts.length;
    countEl.textContent = dataFilterText
      ? `${filtered} of ${total}`
      : `${total} rows`;
  }
}

function renderSummaryCards(data: DataTablePayload): void {
  const cardsEl = document.getElementById("dt-summary-cards");
  if (!cardsEl) return;

  const total =
    data.bySeverity.high + data.bySeverity.medium + data.bySeverity.low;
  const pctHigh = total > 0 ? (data.bySeverity.high / total) * 100 : 0;
  const pctMedium = total > 0 ? (data.bySeverity.medium / total) * 100 : 0;
  const pctLow = total > 0 ? (data.bySeverity.low / total) * 100 : 0;

  cardsEl.innerHTML = `
    <div class="summary-card">
      <div class="summary-card-label">Total Incidents</div>
      <div class="summary-card-value">${data.totalIncidents.toLocaleString()}</div>
      <div class="summary-card-sub">${trendBadgeHtml(data.trend)}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">High Severity</div>
      <div class="summary-card-value">${data.bySeverity.high.toLocaleString()}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Medium Severity</div>
      <div class="summary-card-value">${data.bySeverity.medium.toLocaleString()}</div>
    </div>
    <div class="summary-card">
      <div class="summary-card-label">Low Severity</div>
      <div class="summary-card-value">${data.bySeverity.low.toLocaleString()}</div>
    </div>
    <div class="severity-bar-wrap">
      <div class="severity-bar-label">Severity Distribution</div>
      <div class="severity-bar-track">
        <div class="severity-bar-segment severity-bar-segment-high" style="width:${pctHigh}%"></div>
        <div class="severity-bar-segment severity-bar-segment-medium" style="width:${pctMedium}%"></div>
        <div class="severity-bar-segment severity-bar-segment-low" style="width:${pctLow}%"></div>
      </div>
      <div class="severity-bar-legend">
        <div class="severity-bar-legend-item"><span class="severity-bar-legend-dot severity-bar-legend-dot-high"></span>${data.bySeverity.high}</div>
        <div class="severity-bar-legend-item"><span class="severity-bar-legend-dot severity-bar-legend-dot-medium"></span>${data.bySeverity.medium}</div>
        <div class="severity-bar-legend-item"><span class="severity-bar-legend-dot severity-bar-legend-dot-low"></span>${data.bySeverity.low}</div>
      </div>
    </div>
  `;
}

function renderDataPanel(data: DataTablePayload): void {
  currentDataPayload = data;
  dataFetched = true;

  const panelEl = document.getElementById("data-panel");
  const loadingEl = document.getElementById("dt-loading");
  const contentEl = document.getElementById("dt-content");
  if (panelEl) panelEl.removeAttribute("data-loading");
  if (loadingEl) loadingEl.style.display = "none";
  if (contentEl) contentEl.style.display = "flex";

  // Reset state on fresh data
  dataFilterText = "";
  dataCurrentPage = 0;
  dataSortCol = dataActiveTab === "stats" ? "count" : "date";
  dataSortDir = "desc";

  const filterInput = document.getElementById(
    "dt-filter"
  ) as HTMLInputElement | null;
  if (filterInput) filterInput.value = "";

  renderSummaryCards(data);
  renderActiveDataTable();
}

// ── Fetch data panel (async, non-blocking) ────────────────────────────────────
async function fetchDataPanel(zipCode: string, days: number): Promise<void> {
  const panelEl = document.getElementById("data-panel");
  const loadingEl = document.getElementById("dt-loading");
  const contentEl = document.getElementById("dt-content");

  if (panelEl) panelEl.setAttribute("data-loading", "true");
  if (loadingEl) loadingEl.style.display = "flex";
  if (contentEl) contentEl.style.display = "none";

  dataFetched = false;

  const result = await app.callServerTool({
    name: "get_crime_data",
    arguments: { zipCode, days },
  });

  const data = result.structuredContent as DataTablePayload | undefined;
  if (data) {
    renderDataPanel(data);
  }
}

// ── View tab switching (Map / Data) ───────────────────────────────────────────
function switchViewTab(tab: ViewTab): void {
  activeViewTab = tab;

  const mapEl = document.getElementById("map");
  const legendEl = document.getElementById("legend");
  const dataPanelEl = document.getElementById("data-panel");
  const mapTabBtn = document.getElementById("view-tab-map");
  const dataTabBtn = document.getElementById("view-tab-data");

  if (tab === "map") {
    if (mapEl) mapEl.style.display = "block";
    if (legendEl) legendEl.style.display = "block";
    if (dataPanelEl) dataPanelEl.style.display = "none";
    if (mapTabBtn) mapTabBtn.classList.add("active");
    if (dataTabBtn) dataTabBtn.classList.remove("active");
  } else {
    if (mapEl) mapEl.style.display = "none";
    if (legendEl) legendEl.style.display = "none";
    if (dataPanelEl) dataPanelEl.style.display = "flex";
    if (mapTabBtn) mapTabBtn.classList.remove("active");
    if (dataTabBtn) dataTabBtn.classList.add("active");

    // Lazy-fetch data when switching to data tab for the first time
    if (!dataFetched && currentZip) {
      fetchDataPanel(currentZip, currentDays);
    }
  }
}

// Wire view tab buttons
document.getElementById("view-tab-map")?.addEventListener("click", () => {
  switchViewTab("map");
});
document.getElementById("view-tab-data")?.addEventListener("click", () => {
  switchViewTab("data");
});

// ── Data panel internal tab switching (Statistics / News) ─────────────────────
function activateDataTab(tab: "stats" | "news"): void {
  dataActiveTab = tab;
  dataFilterText = "";
  dataCurrentPage = 0;

  const filterInput = document.getElementById(
    "dt-filter"
  ) as HTMLInputElement | null;
  if (filterInput) filterInput.value = "";

  const tabButtons = document.querySelectorAll<HTMLButtonElement>("#dt-tabs .dt-tab");
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
    btn.setAttribute(
      "aria-selected",
      btn.dataset.tab === tab ? "true" : "false"
    );
  }

  const statsPanel = document.getElementById("dt-stats-panel");
  const newsPanel = document.getElementById("dt-news-panel");
  if (statsPanel) statsPanel.style.display = tab === "stats" ? "block" : "none";
  if (newsPanel) newsPanel.style.display = tab === "news" ? "block" : "none";

  dataSortCol = tab === "stats" ? "count" : "date";
  dataSortDir = "desc";

  renderActiveDataTable();
}

// Wire data panel tab buttons
for (const btn of document.querySelectorAll<HTMLButtonElement>("#dt-tabs .dt-tab")) {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab as "stats" | "news";
    if (tab) activateDataTab(tab);
  });
}

// Wire data panel filter input
const dtFilterInput = document.getElementById("dt-filter") as HTMLInputElement | null;
dtFilterInput?.addEventListener("input", () => {
  dataFilterText = dtFilterInput.value;
  dataCurrentPage = 0;
  renderActiveDataTable();
});

// ── MCP App connection ────────────────────────────────────────────────────────
const app = new App({ name: "neighborhood", version: "1.0.0" });

app.ontoolresult = (params) => {
  const data = params.structuredContent as MapData | undefined;
  if (data) {
    renderMap(data);
    app.sendSizeChanged({ height: 600 });

    // Kick off data panel fetch non-blocking after map is rendered
    fetchDataPanel(data.zipCode, data.days);
  }
};

app.connect().then(() => {
  app.sendSizeChanged({ height: 600 });
});

// ── Zip code editing ──────────────────────────────────────────────────────────
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
  currentZip = trimmed;

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
    // Refresh data panel after zip change
    fetchDataPanel(trimmed, currentDays);
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
