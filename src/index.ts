import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Cross-runtime __dirname: works in both Bun and Node.js ESM
const __dirname = dirname(fileURLToPath(import.meta.url));

import {
  RESOURCE_MIME_TYPE,
  registerAppResource,
  registerAppTool,
} from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { zipToCoordinates } from "./geocode.ts";
import { getAlerts } from "./tools/get-alerts.ts";
import { getCrimeStats } from "./tools/get-crime-stats.ts";
import { getIncidents } from "./tools/get-incidents.ts";
import { listSources } from "./tools/list-sources.ts";
import type { IncidentSource } from "./types.ts";

// ---------------------------------------------------------------------------
// Server setup — McpServer with MCP Apps support
// ---------------------------------------------------------------------------

const MAP_RESOURCE_URI = "ui://neighborhood/map.html";

const server = new McpServer(
  {
    name: "neighborhood",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// ---------------------------------------------------------------------------
// Regular tools (text-based responses)
// ---------------------------------------------------------------------------

server.registerTool(
  "get_incidents",
  {
    title: "Get Crime Incidents",
    description:
      "Fetch recent crime incidents near a US ZIP code. Returns a unified GeoJSON FeatureCollection from ArcGIS, news, and FBI sources. Add FBI_API_KEY for historical data.",
    inputSchema: {
      zipCode: z.string().min(5).max(10).describe("US ZIP code (e.g. 78701)"),
      radius: z
        .number()
        .positive()
        .max(50)
        .optional()
        .default(5)
        .describe("Search radius in miles (default: 5)"),
      sources: z
        .array(z.enum(["arcgis", "fbi", "news"]))
        .optional()
        .describe("Data sources to query (default: all)"),
      days: z
        .number()
        .int()
        .positive()
        .max(365)
        .optional()
        .default(30)
        .describe("Number of days to look back (default: 30)"),
    },
  },
  async (args) => {
    const result = await getIncidents({
      zipCode: args.zipCode,
      radius: args.radius,
      sources: args.sources as IncidentSource[] | undefined,
      days: args.days,
    });
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_crime_stats",
  {
    title: "Get Crime Statistics",
    description:
      "Get aggregated crime statistics for a ZIP code: incident counts by type and severity, trend analysis, and historical FBI data.",
    inputSchema: {
      zipCode: z.string().min(5).max(10).describe("US ZIP code"),
      days: z
        .number()
        .int()
        .positive()
        .max(365)
        .optional()
        .default(30)
        .describe("Number of days for recent trend analysis (default: 30)"),
    },
  },
  async (args) => {
    const result = await getCrimeStats(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "list_sources",
  {
    title: "List Data Sources",
    description:
      "Show all data sources with connection status, what each one provides, and which API keys you can add for more coverage.",
    inputSchema: {},
  },
  async () => {
    const result = await listSources();
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

server.registerTool(
  "get_alerts",
  {
    title: "Get Crime Alerts",
    description:
      "Fetch recent crime news and alerts for a ZIP code from RSS feeds (Google News, Patch.com). Returns article titles, links, and snippets.",
    inputSchema: {
      zipCode: z.string().min(5).max(10).describe("US ZIP code"),
      keywords: z
        .array(z.string())
        .optional()
        .describe(
          "Keywords to filter crime news (default: broad crime-related terms)"
        ),
    },
  },
  async (args) => {
    const result = await getAlerts(args);
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(result, null, 2) },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// MCP App tool — interactive crime map rendered inline
// ---------------------------------------------------------------------------

registerAppTool(
  server,
  "get_map_html",
  {
    title: "Crime Map",
    description:
      "Generate an interactive crime map rendered inline. Shows color-coded markers by crime type with clickable popups, a legend, and a dark UI.",
    inputSchema: {
      zipCode: z.string().min(5).max(10).describe("US ZIP code"),
      radius: z
        .number()
        .positive()
        .max(50)
        .optional()
        .default(5)
        .describe("Search radius in miles (default: 5)"),
      days: z
        .number()
        .int()
        .positive()
        .max(365)
        .optional()
        .default(30)
        .describe("Number of days to include (default: 30)"),
    },
    _meta: {
      ui: {
        resourceUri: MAP_RESOURCE_URI,
      },
    },
  },
  async (args) => {
    const [coords, collection] = await Promise.all([
      zipToCoordinates(args.zipCode),
      getIncidents({
        zipCode: args.zipCode,
        radius: args.radius,
        days: args.days,
      }),
    ]);

    const summary = `${collection.features.length} incidents near ${args.zipCode} (${args.radius}mi, ${args.days}d)`;

    return {
      structuredContent: {
        zipCode: args.zipCode,
        radius: args.radius,
        days: args.days,
        lat: coords.lat,
        lng: coords.lng,
        features: collection.features,
        sourceErrors: collection.sourceErrors,
      },
      content: [{ type: "text" as const, text: summary }],
    };
  }
);

// Register the View HTML resource that the map tool references
registerAppResource(
  server,
  "Crime Map View",
  MAP_RESOURCE_URI,
  {
    description: "Interactive Leaflet crime map with dark theme",
  },
  async () => {
    const viewPath = join(__dirname, "views", "map.html");
    const html = await readFile(viewPath, "utf-8");
    return {
      contents: [
        {
          uri: MAP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: html,
          // CSP must be on the content item — the listing-level _meta is only
          // a static default and may be ignored by hosts.
          _meta: {
            ui: {
              csp: {
                resourceDomains: [
                  "https://unpkg.com",
                  "https://*.tile.openstreetmap.org",
                ],
                connectDomains: ["https://*.tile.openstreetmap.org"],
              },
            },
          },
        },
      ],
    };
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("neighborhood MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
