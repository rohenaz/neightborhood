import type {
  AlertsResult,
  CrimeStats,
  IncidentFeatureCollection,
  SourceStatus,
} from "./types.ts";

// ---------------------------------------------------------------------------
// formatIncidentsSummary — target < 2,000 chars
// ---------------------------------------------------------------------------

export function formatIncidentsSummary(
  collection: IncidentFeatureCollection
): string {
  const { metadata, features, sourceErrors } = collection;
  const lines: string[] = [];

  lines.push(
    `${metadata.totalCount} incidents near ${metadata.zipCode} (${metadata.radius}mi, ${metadata.days}d)`
  );

  // Top 5 crime types
  const topTypes = Object.entries(metadata.countByType)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);
  if (topTypes.length > 0) {
    lines.push("\nBy type:");
    for (const [type, count] of topTypes) {
      lines.push(`  ${type}: ${count}`);
    }
  }

  // Source breakdown
  const sourceCounts = Object.entries(metadata.countBySource).filter(
    ([, n]) => n > 0
  );
  if (sourceCounts.length > 0) {
    lines.push("\nBy source:");
    for (const [src, count] of sourceCounts) {
      lines.push(`  ${src}: ${count}`);
    }
  }

  // 10 most recent incidents
  const sorted = [...features]
    .sort(
      (a, b) =>
        new Date(b.properties.date).getTime() -
        new Date(a.properties.date).getTime()
    )
    .slice(0, 10);

  if (sorted.length > 0) {
    lines.push("\nRecent incidents:");
    for (const f of sorted) {
      const p = f.properties;
      const date = p.date.slice(0, 10);
      lines.push(`  [${date}] ${p.type} at ${p.address} (${p.source})`);
    }
    const remaining = features.length - sorted.length;
    if (remaining > 0) {
      lines.push(`  ...and ${remaining} more`);
    }
  }

  // Source errors
  if (sourceErrors.length > 0) {
    lines.push("\nSource errors:");
    for (const e of sourceErrors) {
      lines.push(`  ${e.source}: ${e.error}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatStatsSummary — target < 1,000 chars
// ---------------------------------------------------------------------------

export function formatStatsSummary(stats: CrimeStats): string {
  const lines: string[] = [];

  lines.push(
    `${stats.totalIncidents} incidents in ${stats.zipCode} over ${stats.days}d — trend: ${stats.trend}`
  );

  // Severity breakdown
  const { bySeverity } = stats;
  lines.push(
    `Severity: ${bySeverity.high ?? 0} high / ${bySeverity.medium ?? 0} medium / ${bySeverity.low ?? 0} low`
  );

  // Top 5 crime types
  if (stats.topTypes.length > 0) {
    lines.push("\nTop crime types:");
    for (const t of stats.topTypes.slice(0, 5)) {
      lines.push(`  ${t.type}: ${t.count} (${t.percentage.toFixed(1)}%)`);
    }
  }

  // Source breakdown
  const sourcePairs = Object.entries(stats.bySource).filter(([, n]) => n > 0);
  if (sourcePairs.length > 0) {
    lines.push("\nBy source:");
    for (const [src, count] of sourcePairs) {
      lines.push(`  ${src}: ${count}`);
    }
  }

  // Source errors
  if (stats.sourceErrors?.length > 0) {
    lines.push("\nSource errors:");
    for (const e of stats.sourceErrors) {
      lines.push(`  ${e.source}: ${e.error}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatAlertsSummary — target < 1,500 chars
// ---------------------------------------------------------------------------

export function formatAlertsSummary(result: AlertsResult): string {
  const lines: string[] = [];
  const displayed = result.alerts.slice(0, 10);

  lines.push(
    `${result.totalCount} crime alerts for ${result.zipCode} (showing ${displayed.length})`
  );

  for (const alert of displayed) {
    const date = alert.publishedAt.slice(0, 10);
    lines.push(`- [${date}] ${alert.title} (${alert.source}) — ${alert.url}`);
  }

  if (result.sourceErrors?.length > 0) {
    lines.push("\nSource errors:");
    for (const e of result.sourceErrors) {
      lines.push(`  ${e.source}: ${e.error}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// formatSourcesList — target < 500 chars
// ---------------------------------------------------------------------------

export function formatSourcesList(
  sources: SourceStatus[],
  summary?: string
): string {
  const lines: string[] = [];

  if (summary) {
    lines.push(summary);
  }

  for (const s of sources) {
    const status = s.online ? "online" : "offline";
    const keyInfo = s.requiresApiKey
      ? s.hasApiKey
        ? " [key set]"
        : ` [needs ${s.apiKeyEnvVar}]`
      : "";
    lines.push(`${s.label} (${s.name}): ${status}${keyInfo}`);
  }

  return lines.join("\n");
}
