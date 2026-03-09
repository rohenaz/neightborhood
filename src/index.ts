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
import {
  formatAlertsSummary,
  formatIncidentsSummary,
  formatSourcesList,
  formatStatsSummary,
} from "./format.ts";
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
        "Text summary of recent crime incidents near a US ZIP code. For interactive visualization, use get_map_html instead.",
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
        format: z
          .enum(["summary", "json"])
          .optional()
          .default("summary")
          .describe(
            "Output format: 'summary' for concise text (default), 'json' for raw data"
          ),
      },
    },
    async (args) => {
      const result = await getIncidents({
        zipCode: args.zipCode,
        radius: args.radius,
        sources: args.sources as IncidentSource[] | undefined,
        days: args.days,
      });
      const text =
        args.format === "json"
          ? JSON.stringify(result, null, 2)
          : formatIncidentsSummary(result);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "get_crime_stats",
    {
      title: "Get Crime Statistics",
      description:
        "Text summary of aggregated crime statistics for a ZIP code. For interactive visualization, use get_crime_data instead.",
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
        format: z
          .enum(["summary", "json"])
          .optional()
          .default("summary")
          .describe(
            "Output format: 'summary' for concise text (default), 'json' for raw data"
          ),
      },
    },
    async (args) => {
      const result = await getCrimeStats(args);
      const text =
        args.format === "json"
          ? JSON.stringify(result, null, 2)
          : formatStatsSummary(result);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "list_sources",
    {
      title: "List Data Sources",
      description:
        "Show all data sources with connection status, what each one provides, and which API keys you can add for more coverage.",
      inputSchema: {
        format: z
          .enum(["summary", "json"])
          .optional()
          .default("summary")
          .describe(
            "Output format: 'summary' for concise text (default), 'json' for raw data"
          ),
      },
    },
    async (args) => {
      const result = await listSources();
      const text =
        args.format === "json"
          ? JSON.stringify(result, null, 2)
          : formatSourcesList(result);
      return {
        content: [{ type: "text" as const, text }],
      };
    }
  );

  server.registerTool(
    "get_alerts",
    {
      title: "Get Crime Alerts",
      description:
        "Brief text summary of recent crime news for a ZIP code. For full interactive view with filtering, use get_crime_data instead.",
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
        format: z
          .enum(["summary", "json"])
          .optional()
          .default("summary")
          .describe(
            "Output format: 'summary' for concise text (default), 'json' for raw data"
          ),
      },
    },
    async (args) => {
      const result = await getAlerts(args);
      const text =
        args.format === "json"
          ? JSON.stringify(result, null, 2)
          : formatAlertsSummary(result);
      return {
        content: [{ type: "text" as const, text }],
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
        "This is the PRIMARY tool for neighborhood safety queries. Shows all incident data on an interactive map with color-coded markers by crime type, clickable popups, a legend, and a dark UI.",
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

      // Build unified source status — merge config + fetch results
      const errorsBySource = new Map(
        (collection.sourceErrors ?? []).map((e) => [e.source, e.error])
      );
      const sources = SOURCE_METADATA.map((m) => {
        const hasApiKey = m.requiresApiKey
          ? Boolean(m.apiKeyEnvVar && process.env[m.apiKeyEnvVar])
          : true;
        const fetchError = errorsBySource.get(m.name);
        return {
          name: m.name,
          label: m.label,
          requiresApiKey: m.requiresApiKey,
          apiKeyEnvVar: m.apiKeyEnvVar,
          signupUrl: m.signupUrl,
          hasApiKey,
          isOnline: hasApiKey && !fetchError,
          error: fetchError,
        };
      });

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
          sources,
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
        "App-only tool: fetches stats and alerts to populate the data panel in the map view. Not intended for direct model invocation.",
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
          resourceUri: MAP_RESOURCE_URI,
          visibility: ["app"],
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
