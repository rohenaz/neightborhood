import { zipToCoordinates } from "../geocode.ts";
import type { IncidentFeature } from "../types.ts";
import { getIncidents } from "./get-incidents.ts";

export interface GetMapHtmlInput {
  zipCode: string;
  radius?: number;
  days?: number;
}

// Color mapping by crime type
function pinColor(type: string, severity?: string): string {
  if (severity === "high") return "#dc2626"; // red
  if (severity === "medium") return "#f59e0b"; // amber

  const lower = type.toLowerCase();
  if (lower.includes("theft") || lower.includes("burglary")) return "#3b82f6"; // blue
  if (lower.includes("assault") || lower.includes("robbery")) return "#dc2626"; // red
  if (lower.includes("auto") || lower.includes("vehicle")) return "#8b5cf6"; // purple
  if (lower.includes("drug") || lower.includes("narcotic")) return "#ec4899"; // pink
  if (lower.includes("vandal")) return "#f59e0b"; // amber
  if (lower.includes("sex") || lower.includes("offender")) return "#7c3aed"; // violet
  if (lower.includes("news") || lower.includes("alert")) return "#6b7280"; // gray
  return "#22c55e"; // green for other/low severity
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function featureToMarkerJs(feature: IncidentFeature, idx: number): string {
  const { coordinates } = feature.geometry;
  const lat = coordinates[1];
  const lng = coordinates[0];
  const p = feature.properties;
  const color = pinColor(p.type, p.severity);
  const date = new Date(p.date).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const linkHtml = p.url
    ? `<br/><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer" style="color:#3b82f6">View source</a>`
    : "";
  const popupContent = `
    <div style="font-family:sans-serif;min-width:180px;max-width:280px">
      <strong style="font-size:14px;color:${color}">${escapeHtml(p.type)}</strong>
      <div style="margin-top:4px;font-size:12px;color:#374151">${escapeHtml(p.description)}</div>
      <div style="margin-top:6px;font-size:11px;color:#6b7280">
        <div>${escapeHtml(p.address)}</div>
        <div>${date}</div>
        <div style="text-transform:uppercase;letter-spacing:0.05em;margin-top:2px">${escapeHtml(p.source)}${p.severity ? ` · ${escapeHtml(p.severity)}` : ""}</div>
        ${linkHtml}
      </div>
    </div>
  `.trim();

  return `
  (function() {
    var marker${idx} = L.circleMarker([${lat}, ${lng}], {
      radius: 7,
      fillColor: "${color}",
      color: "#ffffff",
      weight: 1.5,
      opacity: 1,
      fillOpacity: 0.85
    }).addTo(map);
    marker${idx}.bindPopup(${JSON.stringify(popupContent)});
  })();`.trim();
}

function buildLegendItems(features: IncidentFeature[]): string {
  const types = new Map<string, string>();
  for (const f of features) {
    if (!types.has(f.properties.type)) {
      types.set(
        f.properties.type,
        pinColor(f.properties.type, f.properties.severity)
      );
    }
  }

  return Array.from(types.entries())
    .slice(0, 12) // cap legend size
    .map(
      ([type, color]) =>
        `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
          <div style="width:12px;height:12px;border-radius:50%;background:${color};border:1px solid #fff;flex-shrink:0"></div>
          <span style="font-size:11px">${escapeHtml(type)}</span>
        </div>`
    )
    .join("\n");
}

export async function getMapHtml(input: GetMapHtmlInput): Promise<string> {
  const { zipCode, radius = 5, days = 30 } = input;

  const [coords, collection] = await Promise.all([
    zipToCoordinates(zipCode),
    getIncidents({ zipCode, radius, days }),
  ]);

  const { lat, lng } = coords;
  const features = collection.features;
  const markersJs = features.map(featureToMarkerJs).join("\n");
  const legendItems = buildLegendItems(features);

  const errorBanner =
    collection.sourceErrors.length > 0
      ? `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:8px 12px;margin-bottom:12px;font-size:12px;color:#92400e">
          <strong>Some sources had errors:</strong>
          ${collection.sourceErrors.map((e) => `<div>${escapeHtml(e.source)}: ${escapeHtml(e.error)}</div>`).join("")}
        </div>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Crime Map — ${escapeHtml(zipCode)}</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #111827; color: #f9fafb; height: 100vh; display: flex; flex-direction: column; }
    #header { padding: 12px 16px; background: #1f2937; border-bottom: 1px solid #374151; flex-shrink: 0; }
    #header h1 { font-size: 16px; font-weight: 600; }
    #header p { font-size: 12px; color: #9ca3af; margin-top: 2px; }
    #map { flex: 1; }
    #legend {
      position: absolute;
      bottom: 24px;
      right: 12px;
      z-index: 1000;
      background: rgba(17,24,39,0.92);
      border: 1px solid #374151;
      border-radius: 8px;
      padding: 10px 12px;
      max-height: 280px;
      overflow-y: auto;
      color: #f9fafb;
      min-width: 140px;
    }
    #legend h3 { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 8px; color: #9ca3af; }
    #errors { position: absolute; top: 70px; left: 50%; transform: translateX(-50%); z-index: 1000; max-width: 500px; width: 90%; }
  </style>
</head>
<body>
  <div id="header">
    <h1>Crime Map — Zip Code ${escapeHtml(zipCode)}</h1>
    <p>${features.length} incidents within ${radius}mi · last ${days} days · ${new Date().toLocaleDateString()}</p>
  </div>
  <div id="map"></div>
  <div id="legend">
    <h3>Crime Types</h3>
    ${legendItems}
  </div>
  ${errorBanner ? `<div id="errors">${errorBanner}</div>` : ""}

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV/XN/WLs=" crossorigin=""></script>
  <script>
    var map = L.map('map').setView([${lat}, ${lng}], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }).addTo(map);

    // Center marker
    L.circleMarker([${lat}, ${lng}], {
      radius: 10,
      fillColor: "#3b82f6",
      color: "#1d4ed8",
      weight: 2,
      fillOpacity: 0.5
    }).addTo(map).bindPopup("<strong>Search Center</strong><br/>ZIP ${escapeHtml(zipCode)}");

    // Radius circle
    L.circle([${lat}, ${lng}], {
      radius: ${radius * 1609.34},
      color: "#3b82f6",
      fillColor: "#3b82f6",
      fillOpacity: 0.04,
      weight: 1,
      dashArray: "4 4"
    }).addTo(map);

    // Crime markers
    ${markersJs}
  </script>
</body>
</html>`;
}
