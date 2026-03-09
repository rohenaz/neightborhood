import { App } from "@modelcontextprotocol/ext-apps";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

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
}

let currentMap: L.Map | null = null;
let currentRadius = 5;
let currentDays = 30;

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

      // Build popover rows
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
        // Close sources popover if open
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

  // Leaflet map
  const map = L.map("map", { zoomControl: false }).setView([lat, lng], 13);
  currentMap = map;
  L.control.zoom({ position: "topright" }).addTo(map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
    maxZoom: 19,
  }).addTo(map);

  // Search area circle
  L.circle([lat, lng], {
    radius: radius * 1609.34,
    color: COLORS.accent,
    fillColor: COLORS.accent,
    fillOpacity: 0.04,
    weight: 1,
    dashArray: "6 4",
  }).addTo(map);

  // Center pin
  L.circleMarker([lat, lng], {
    radius: 8,
    fillColor: COLORS.accent,
    color: COLORS.background,
    weight: 2,
    fillOpacity: 0.6,
  })
    .addTo(map)
    .bindPopup(
      `<div class="popup"><strong>ZIP ${esc(zipCode)}</strong></div>`,
      {
        className: "dark-popup",
      }
    );

  // Incident markers
  const markers = L.layerGroup().addTo(map);
  const typeColors = new Map<string, string>();

  for (const feature of features) {
    const [fLng, fLat] = feature.geometry.coordinates;
    const p = feature.properties;
    const color = pinColor(p.type, p.severity);

    if (!typeColors.has(p.type)) typeColors.set(p.type, color);

    const date = new Date(p.date).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const linkHtml = p.url
      ? `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer" class="popup-link">View source &rarr;</a>`
      : "";
    const severityBadge = p.severity
      ? `<span class="badge badge-${p.severity}">${p.severity}</span>`
      : "";

    const popup = `
      <div class="popup">
        <div class="popup-header">
          <span class="popup-dot" style="background:${color}"></span>
          <strong>${esc(p.type)}</strong>
          ${severityBadge}
        </div>
        <p class="popup-desc">${esc(p.description)}</p>
        <div class="popup-meta">
          <span>${esc(p.address)}</span>
          <span>${date}</span>
          <span class="popup-source">${esc(p.source)}</span>
        </div>
        ${linkHtml}
      </div>
    `;

    L.circleMarker([fLat, fLng], {
      radius: 6,
      fillColor: color,
      color: COLORS.background,
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.9,
    })
      .addTo(markers)
      .bindPopup(popup, { className: "dark-popup", maxWidth: 300 });
  }

  // Legend
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
}

// Connect to the MCP host and receive tool result data.
// Handlers MUST be registered before connect() to avoid missing notifications.
const app = new App({ name: "neighborhood", version: "1.0.0" });

// ontoolresult receives CallToolResult as params.
// structuredContent is a top-level field on CallToolResult.
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

  // Show loading state in meta
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
