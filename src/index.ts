import { randomUUID } from "node:crypto";
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
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { zipToCoordinates } from "./geocode.ts";
import { discoverScannerFeeds } from "./sources/scanner.ts";
import { getAlerts } from "./tools/get-alerts.ts";
import { getCrimeStats } from "./tools/get-crime-stats.ts";
import { getIncidents } from "./tools/get-incidents.ts";
import { listSources, SOURCE_METADATA } from "./tools/list-sources.ts";
import type { IncidentSource } from "./types.ts";

// ---------------------------------------------------------------------------
// Server factory — creates a fully-configured McpServer per connection.
// Each transport needs its own McpServer instance; a single McpServer cannot
// be shared across multiple transports.
// ---------------------------------------------------------------------------

const MAP_RESOURCE_URI = "ui://neighborhood/map.html";
const DATA_TABLE_RESOURCE_URI = "ui://neighborhood/data-table";

function createServer(): McpServer {
  const srv = new McpServer(
    {
      name: "neighborhood",
      version: "1.0.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
        experimental: {
          "io.modelcontextprotocol/ui": { version: "0.1" },
        },
      },
    }
  );

  registerTools(srv);
  registerResources(srv);

  return srv;
}

// ---------------------------------------------------------------------------
// Regular tools (text-based responses)
// ---------------------------------------------------------------------------

function registerTools(server: McpServer) {
  server.registerTool(
    "get_incidents",
    {
      title: "Get Crime Incidents",
      description:
        "Fetch recent crime incidents near a US ZIP code. Returns a unified GeoJSON FeatureCollection from ArcGIS, Socrata, and SpotCrime sources.",
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
          .array(z.enum(["arcgis", "socrata", "spotcrime"]))
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
        "Get aggregated crime statistics for a ZIP code: incident counts by type and severity, and trend analysis.",
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
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Max alerts to return (default: 20)"),
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
} // end registerTools

// ---------------------------------------------------------------------------
// MCP App tool + resource — interactive crime map rendered inline
// ---------------------------------------------------------------------------

function registerResources(server: McpServer) {
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

      // Discover scanner feeds in parallel (non-blocking — failures return [])
      let scannerFeeds: Awaited<ReturnType<typeof discoverScannerFeeds>> = [];
      try {
        scannerFeeds = await discoverScannerFeeds(
          args.zipCode,
          coords.lat,
          coords.lng,
          coords.displayName ?? ""
        );
      } catch {
        // Scanner discovery is optional — don't block the map
      }

      const summary = `${collection.features.length} incidents near ${args.zipCode} (${args.radius}mi, ${args.days}d)`;

      return {
        structuredContent: {
          zipCode: args.zipCode,
          radius: args.radius,
          days: args.days,
          lat: coords.lat,
          lng: coords.lng,
          mapboxToken: process.env.MAPBOX_TOKEN || undefined,
          features: collection.features,
          sourceErrors: collection.sourceErrors,
          scannerFeeds,
          sources: SOURCE_METADATA.map((m) => ({
            name: m.name,
            label: m.label,
            requiresApiKey: m.requiresApiKey,
            apiKeyEnvVar: m.apiKeyEnvVar,
            signupUrl: m.signupUrl,
            hasApiKey: m.requiresApiKey
              ? Boolean(m.apiKeyEnvVar && process.env[m.apiKeyEnvVar])
              : true,
          })),
        },
        content: [{ type: "text" as const, text: summary }],
        _meta: {
          viewUUID: randomUUID(),
        },
      };
    }
  );

  // Register the View HTML resource that the map tool references
  registerAppResource(
    server,
    "Crime Map View",
    MAP_RESOURCE_URI,
    {
      description: "Interactive MapLibre GL crime map with dark theme",
    },
    async () => {
      // Prefer the Vite-built single-file bundle; fall back to source only in
      // development when the dist hasn't been built yet (will fail visibly).
      const distPath = join(__dirname, "..", "dist", "map.html");

      let viewPath: string;
      try {
        await readFile(distPath, "utf-8");
        viewPath = distPath;
      } catch {
        throw new Error(
          `Bundled view not found at ${distPath}. Run 'bun run build:view' first.`
        );
      }

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
                  // All JS/CSS is inlined by vite-plugin-singlefile; tile
                  // and style requests need network access.
                  resourceDomains: [
                    "https://basemaps.cartocdn.com",
                    "https://*.basemaps.cartocdn.com",
                    "https://tiles.basemaps.cartocdn.com",
                    "https://api.mapbox.com",
                    "https://*.tiles.mapbox.com",
                  ],
                  connectDomains: [
                    "https://basemaps.cartocdn.com",
                    "https://*.basemaps.cartocdn.com",
                    "https://tiles.basemaps.cartocdn.com",
                    "https://api.mapbox.com",
                    "https://*.tiles.mapbox.com",
                  ],
                },
              },
            },
          },
        ],
      };
    }
  );

  // ---------------------------------------------------------------------------
  // MCP App tool + resource — crime stats & alerts data table rendered inline
  // ---------------------------------------------------------------------------

  registerAppTool(
    server,
    "get_crime_data",
    {
      title: "Crime Data Table",
      description:
        "Generate an interactive crime statistics and alerts table rendered inline. Shows incident counts by severity and type, trend analysis, and recent news alerts.",
      inputSchema: {
        zipCode: z.string().min(5).max(10).describe("US ZIP code"),
        days: z
          .number()
          .int()
          .positive()
          .max(365)
          .optional()
          .default(30)
          .describe("Number of days for trend analysis (default: 30)"),
      },
      _meta: {
        ui: {
          resourceUri: DATA_TABLE_RESOURCE_URI,
        },
      },
    },
    async (args) => {
      const [stats, alertsResult] = await Promise.all([
        getCrimeStats({ zipCode: args.zipCode, days: args.days }),
        getAlerts({ zipCode: args.zipCode }),
      ]);

      const summary = `${stats.totalIncidents} incidents in ${args.zipCode} over ${args.days}d — trend: ${stats.trend}, ${alertsResult.alerts.length} alerts`;

      return {
        structuredContent: {
          zipCode: args.zipCode,
          days: args.days,
          totalIncidents: stats.totalIncidents,
          trend: stats.trend,
          bySeverity: stats.bySeverity,
          topTypes: stats.topTypes,
          bySource: stats.bySource,
          alerts: alertsResult.alerts,
          sourceErrors: [
            ...(stats.sourceErrors || []),
            ...(alertsResult.sourceErrors || []),
          ],
          generatedAt: stats.generatedAt,
        },
        content: [{ type: "text" as const, text: summary }],
        _meta: {
          viewUUID: randomUUID(),
        },
      };
    }
  );

  // Register the View HTML resource that the data table tool references
  registerAppResource(
    server,
    "Crime Data Table View",
    DATA_TABLE_RESOURCE_URI,
    {
      description: "Interactive crime statistics and alerts data table",
    },
    async () => {
      const distPath = join(__dirname, "..", "dist", "data-table.html");

      try {
        await readFile(distPath, "utf-8");
      } catch {
        throw new Error(
          `Bundled view not found at ${distPath}. Run 'bun run build:view' first.`
        );
      }

      const html = await readFile(distPath, "utf-8");
      return {
        contents: [
          {
            uri: DATA_TABLE_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
          },
        ],
      };
    }
  );
} // end registerResources

// ---------------------------------------------------------------------------
// Start — dual-mode: --stdio for CLI, HTTP for Desktop
// ---------------------------------------------------------------------------

const useStdio = process.argv.includes("--stdio");

async function main() {
  if (useStdio) {
    // Stdio: single long-lived server connected to one transport
    const srv = createServer();
    const transport = new StdioServerTransport();
    await srv.connect(transport);
    console.error("neighborhood MCP server running on stdio");
    return;
  }

  const port = Number(process.env.PORT) || 3001;
  const app = new Hono();

  // Expose mcp-session-id so clients can read it from CORS responses
  app.use(
    "/*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowHeaders: [
        "Content-Type",
        "mcp-session-id",
        "Last-Event-ID",
        "mcp-protocol-version",
      ],
      exposeHeaders: ["mcp-session-id", "mcp-protocol-version"],
    })
  );

  // Stateless mode: one McpServer + one transport per request.
  // WebStandardStreamableHTTPServerTransport with sessionIdGenerator: undefined
  // disables session management — the transport handles a single request/response
  // cycle and cannot be reused. This avoids the multi-transport limitation of McpServer.
  app.all("/mcp", async (c) => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless — no session tracking
      enableJsonResponse: true, // return JSON instead of SSE for simpler clients
    });
    const srv = createServer();
    await srv.connect(transport);
    return transport.handleRequest(c.req.raw);
  });

  // Health check
  app.get("/", (c) => c.json({ name: "neighborhood", status: "ok" }));

  console.error(
    `neighborhood MCP server running on http://localhost:${port}/mcp`
  );
  Bun.serve({ fetch: app.fetch, port });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
