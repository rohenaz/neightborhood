import { App } from "@modelcontextprotocol/ext-apps";

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

// ── State ──────────────────────────────────────────────────────────────────
let activeTab: "stats" | "news" = "stats";
let filterText = "";
let sortCol = "count";
let sortDir: "asc" | "desc" = "desc";
let currentPage = 0;
const PAGE_SIZE = 25;
let currentData: DataTablePayload | null = null;
let currentDays = 30;

// ── XSS helper ─────────────────────────────────────────────────────────────
function esc(s: string): string {
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

// ── Trend badge ────────────────────────────────────────────────────────────
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

// ── Sort helpers ────────────────────────────────────────────────────────────
function sortedTypes(
  rows: DataTablePayload["topTypes"]
): DataTablePayload["topTypes"] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "type") {
      cmp = a.type.localeCompare(b.type);
    } else if (sortCol === "percentage") {
      cmp = a.percentage - b.percentage;
    } else {
      // count
      cmp = a.count - b.count;
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
}

function sortedNews(
  rows: DataTablePayload["alerts"]
): DataTablePayload["alerts"] {
  return [...rows].sort((a, b) => {
    let cmp = 0;
    if (sortCol === "title") {
      cmp = a.title.localeCompare(b.title);
    } else if (sortCol === "source") {
      cmp = a.source.localeCompare(b.source);
    } else {
      // date
      cmp =
        new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime();
    }
    return sortDir === "asc" ? cmp : -cmp;
  });
}

// ── Sort indicator ─────────────────────────────────────────────────────────
function sortClass(col: string): string {
  if (col !== sortCol) return "sortable";
  return `sortable ${sortDir === "asc" ? "sort-asc" : "sort-desc"}`;
}

function sortIndicator(col: string): string {
  if (col !== sortCol) return '<span class="sort-arrow">⇅</span>';
  return `<span class="sort-arrow">${sortDir === "asc" ? "▲" : "▼"}</span>`;
}

// ── Pagination HTML ─────────────────────────────────────────────────────────
function renderPagination(totalItems: number): void {
  const paginationEl = document.getElementById("pagination");
  if (!paginationEl) return;

  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const onFirst = currentPage === 0;
  const onLast = currentPage >= totalPages - 1;

  paginationEl.innerHTML = `
    <button id="prev-page" class="pagination-btn" ${onFirst ? "disabled" : ""}>&#8592; Prev</button>
    <span class="pagination-info">Page ${currentPage + 1} of ${totalPages}</span>
    <button id="next-page" class="pagination-btn" ${onLast ? "disabled" : ""}>Next &#8594;</button>
  `;

  document.getElementById("prev-page")?.addEventListener("click", () => {
    if (currentPage > 0) {
      currentPage--;
      renderActiveTable();
    }
  });

  document.getElementById("next-page")?.addEventListener("click", () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderActiveTable();
    }
  });
}

// ── Stats table render ──────────────────────────────────────────────────────
function renderStatsTable(): void {
  if (!currentData) return;

  const headEl = document.getElementById("stats-head");
  const bodyEl = document.getElementById("stats-body");
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
      if (col === sortCol) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = "desc";
      }
      currentPage = 0;
      renderStatsTable();
      renderPagination(filteredTypes().length);
    });
  }

  const filtered = filteredTypes();

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <tr><td colspan="3" class="empty-state">
        ${
          currentData.topTypes.length === 0
            ? "No crime statistics available. Set FBI_API_KEY for historical data."
            : "No results match your filter."
        }
      </td></tr>
    `;
    renderPagination(0);
    return;
  }

  const sorted = sortedTypes(filtered);
  const start = currentPage * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

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

  renderPagination(filtered.length);
}

// ── News table render ───────────────────────────────────────────────────────
function renderNewsTable(): void {
  if (!currentData) return;

  const headEl = document.getElementById("news-head");
  const bodyEl = document.getElementById("news-body");
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
      if (col === sortCol) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = col;
        sortDir = "desc";
      }
      currentPage = 0;
      renderNewsTable();
      renderPagination(filteredAlerts().length);
    });
  }

  const filtered = filteredAlerts();

  if (filtered.length === 0) {
    bodyEl.innerHTML = `
      <tr><td colspan="3" class="empty-state">
        ${
          currentData.alerts.length === 0
            ? "No crime news found for this area."
            : "No results match your filter."
        }
      </td></tr>
    `;
    renderPagination(0);
    return;
  }

  const sorted = sortedNews(filtered);
  const start = currentPage * PAGE_SIZE;
  const page = sorted.slice(start, start + PAGE_SIZE);

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

  renderPagination(filtered.length);
}

// ── Filter helpers ──────────────────────────────────────────────────────────
function filteredTypes(): DataTablePayload["topTypes"] {
  if (!currentData) return [];
  if (!filterText) return currentData.topTypes;
  const q = filterText.toLowerCase();
  return currentData.topTypes.filter((r) => r.type.toLowerCase().includes(q));
}

function filteredAlerts(): DataTablePayload["alerts"] {
  if (!currentData) return [];
  if (!filterText) return currentData.alerts;
  const q = filterText.toLowerCase();
  return currentData.alerts.filter(
    (r) =>
      r.title.toLowerCase().includes(q) || r.source.toLowerCase().includes(q)
  );
}

// ── Render active table (called after state changes) ───────────────────────
function renderActiveTable(): void {
  if (activeTab === "stats") {
    renderStatsTable();
  } else {
    renderNewsTable();
  }

  // Update toolbar count
  const countEl = document.getElementById("toolbar-count");
  if (countEl && currentData) {
    const filtered = activeTab === "stats" ? filteredTypes().length : filteredAlerts().length;
    const total = activeTab === "stats" ? currentData.topTypes.length : currentData.alerts.length;
    countEl.textContent = filterText
      ? `${filtered} of ${total}`
      : `${total} rows`;
  }
}

// ── Summary panel ───────────────────────────────────────────────────────────
function renderSummary(data: DataTablePayload): void {
  const cardsEl = document.getElementById("summary-cards");
  if (!cardsEl) return;

  const total = data.bySeverity.high + data.bySeverity.medium + data.bySeverity.low;
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

// ── Main render ─────────────────────────────────────────────────────────────
function renderData(data: DataTablePayload): void {
  currentData = data;
  currentDays = data.days;

  const loadingEl = document.getElementById("loading");
  const appEl = document.getElementById("app");
  if (loadingEl) loadingEl.style.display = "none";
  if (appEl) appEl.style.display = "flex";

  // Header: ZIP + meta
  const zipEl = document.getElementById("zip") as HTMLElement | null;
  const metaEl = document.getElementById("meta");
  if (zipEl) zipEl.textContent = data.zipCode;
  if (metaEl) {
    const sourceCount = Object.keys(data.bySource).length;
    metaEl.innerHTML = `
      <span><span class="stat">${data.totalIncidents.toLocaleString()}</span> incidents</span>
      <span><span class="stat">${sourceCount}</span> sources</span>
      <span>last <span class="stat">${data.days}</span> days</span>
    `;
  }

  // Error badges
  if (data.sourceErrors && data.sourceErrors.length > 0) {
    const errorsEl = document.getElementById("header-errors");
    if (errorsEl) {
      errorsEl.innerHTML = data.sourceErrors
        .map(
          (e) =>
            `<span class="header-error-badge">${esc(e.source)} offline</span>`
        )
        .join("");
    }
  }

  // Summary panel
  renderSummary(data);

  // Reset tab state on new data
  filterText = "";
  currentPage = 0;
  sortCol = activeTab === "stats" ? "count" : "date";
  sortDir = "desc";

  const filterInput = document.getElementById(
    "filter"
  ) as HTMLInputElement | null;
  if (filterInput) filterInput.value = "";

  renderActiveTable();
}

// ── MCP App connection ──────────────────────────────────────────────────────
const app = new App({ name: "neighborhood-data", version: "1.0.0" });

app.ontoolresult = (params) => {
  const data = params.structuredContent as DataTablePayload | undefined;
  if (data) {
    renderData(data);
    app.sendSizeChanged({ height: 600 });
  }
};

app.connect().then(() => {
  app.sendSizeChanged({ height: 600 });
});

// ── Tab switching ───────────────────────────────────────────────────────────
const tabButtons = document.querySelectorAll<HTMLButtonElement>("#tabs .tab");
const statsPanel = document.getElementById("stats-panel");
const newsPanel = document.getElementById("news-panel");

function activateTab(tab: "stats" | "news"): void {
  activeTab = tab;
  filterText = "";
  currentPage = 0;

  const filterInput = document.getElementById(
    "filter"
  ) as HTMLInputElement | null;
  if (filterInput) filterInput.value = "";

  // Update tab button states
  for (const btn of tabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
    btn.setAttribute("aria-selected", btn.dataset.tab === tab ? "true" : "false");
  }

  // Show/hide panels
  if (statsPanel) statsPanel.style.display = tab === "stats" ? "block" : "none";
  if (newsPanel) newsPanel.style.display = tab === "news" ? "block" : "none";

  // Reset sort defaults per tab
  sortCol = tab === "stats" ? "count" : "date";
  sortDir = "desc";

  renderActiveTable();
}

for (const btn of tabButtons) {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab as "stats" | "news";
    if (tab) activateTab(tab);
  });
}

// ── Filter input ────────────────────────────────────────────────────────────
const filterInput = document.getElementById("filter") as HTMLInputElement | null;
filterInput?.addEventListener("input", () => {
  filterText = filterInput.value;
  currentPage = 0;
  renderActiveTable();
});

// ── ZIP code editing (mirrors mcp-app.ts pattern exactly) ──────────────────
const zipDisplay = document.getElementById("zip") as HTMLElement;
const zipForm = document.getElementById("zip-form") as HTMLFormElement;
const zipInput = document.getElementById("zip-input") as HTMLInputElement;

function showZipEditor(): void {
  zipInput.value = zipDisplay.textContent ?? "";
  zipDisplay.style.display = "none";
  zipForm.style.display = "block";
  zipInput.focus();
  zipInput.select();
}

function hideZipEditor(): void {
  zipForm.style.display = "none";
  zipDisplay.style.display = "block";
}

async function submitZip(newZip: string): Promise<void> {
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
    name: "get_crime_data",
    arguments: { zipCode: trimmed, days: currentDays },
  });

  const data = result.structuredContent as DataTablePayload | undefined;
  if (data) {
    renderData(data);
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
