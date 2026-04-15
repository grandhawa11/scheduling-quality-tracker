import { useState, useCallback, useMemo, useEffect, useRef } from "react";

const JIRA_BASE_URL = import.meta.env.VITE_JIRA_BASE_URL || "https://joinhomebase.atlassian.net";
const JIRA_EMAIL    = import.meta.env.VITE_JIRA_EMAIL    || "";
const JIRA_TOKEN    = import.meta.env.VITE_JIRA_API_TOKEN || "";

const URL_PARAMS = new URLSearchParams(window.location.search);
const SHEET_ID   = URL_PARAMS.get("sheet") || "";
const TEAM_PRESETS = [
  { label: "Scheduling", project: "SB" },
  { label: "HRM", project: "HRM" },
  { label: "Payroll", project: "PAY" },
];
const buildJql = (proj) => `project = "${proj}" AND (labels = "Quality" OR Allocation = "Quality Improvements" OR summary ~ "[Quality]") ORDER BY status ASC, updated DESC`;
const DEFAULT_JQL = URL_PARAMS.get("jql") || buildJql(TEAM_PRESETS[0].project);

// Parse a free-text date string into YYYY-MM format (or null)
// Handles: "06/01/2026", "June 1, 2026", "June 1st, 2026", "Jun 2026", "2026-06-01"
const MONTH_MAP = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };

function parseTextDate(raw) {
  if (!raw || typeof raw !== "string") return null;
  const s = raw.trim();

  // ISO: 2026-06-01
  const iso = s.match(/^(\d{4})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}`;

  // m/d/y or m-d-y: 06/01/2026, 6/1/2026
  const mdy = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (mdy) {
    const m = parseInt(mdy[1], 10);
    if (m >= 1 && m <= 12) return `${mdy[3]}-${String(m).padStart(2, "0")}`;
  }

  // "June 1, 2026", "June 1st 2026", "Jun 2026"
  const named = s.match(/^([a-z]+)\s*\d{0,2}[a-z]*[,\s]*(\d{4})$/i);
  if (named) {
    const m = MONTH_MAP[named[1].toLowerCase()];
    if (m !== undefined) return `${named[2]}-${String(m + 1).padStart(2, "0")}`;
  }

  return null;
}

// Extract plain text from Jira ADF (Atlassian Document Format) description
function extractAdfText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content)) return node.content.map(extractAdfText).join(" ");
  return "";
}

function getBucket(ticket, bucketRules) {
  const haystack = `${ticket.summary} ${ticket.epic || ""}`.toLowerCase();
  for (const bucket of bucketRules) {
    if (bucket.keywords.some(k => haystack.includes(k))) return bucket.label;
  }
  return "Other";
}

const STATUS_CONFIG = {
  "Done":                   { color: "#22c55e", bg: "#f0fdf4", label: "✓ Done" },
  "In Progress":            { color: "#3b82f6", bg: "#eff6ff", label: "● In Progress" },
  "In Review":              { color: "#a855f7", bg: "#faf5ff", label: "◎ In Review" },
  "Investigation Required": { color: "#f59e0b", bg: "#fffbeb", label: "⚑ Investigating" },
  "Backlog":                { color: "#6b7280", bg: "#f9fafb", label: "○ Backlog" },
  "Won't Do":               { color: "#ef4444", bg: "#fef2f2", label: "✕ Won't Do" },
  "To Do":                  { color: "#6b7280", bg: "#f9fafb", label: "○ To Do" },
};

const PRIORITY_CONFIG = {
  Highest: { color: "#ef4444", icon: "↑↑" },
  High:    { color: "#f97316", icon: "↑"  },
  Medium:  { color: "#f59e0b", icon: "→"  },
  Low:     { color: "#6b7280", icon: "↓"  },
  Lowest:  { color: "#9ca3af", icon: "↓↓" },
};

const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function buildPeriodOptions() {
  const now = new Date();
  const nowY = now.getFullYear();
  const nowM = now.getMonth();
  const ym = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const opts = [{ key: "all", label: "All Time" }];
  // Current + 12 past months
  for (let i = 0; i < 12; i++) {
    const d = new Date(nowY, nowM - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const key = ym(y, m);
    opts.push({ key, label: `${MONTH_NAMES[m]}${y !== nowY ? " " + y : ""}`, startYM: key, endYM: key });
  }
  // 6 future months (after current)
  for (let i = 1; i <= 6; i++) {
    const d = new Date(nowY, nowM + i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    const key = ym(y, m);
    opts.push({ key, label: `${MONTH_NAMES[m]}${y !== nowY ? " " + y : ""}`, startYM: key, endYM: key, future: true });
  }
  // Quarters (current year + last year, including quarters that overlap with future)
  const currentYM = ym(nowY, nowM);
  for (const y of [nowY, nowY - 1]) {
    for (let q = 3; q >= 0; q--) {
      const sm = q * 3;
      const endMonth = sm + 2;
      // Skip if the entire quarter is in the future
      if (new Date(y, sm, 1) > now) continue;
      const qEndYM = ym(y, endMonth);
      opts.push({
        key: `Q${q + 1}-${y}`,
        label: `Q${q + 1} ${y} (${MONTH_NAMES[sm]}–${MONTH_NAMES[endMonth]})`,
        startYM: ym(y, sm),
        endYM: qEndYM,
        future: qEndYM > currentYM, // quarter extends into future months
      });
    }
  }
  return opts;
}

const PERIOD_OPTIONS = buildPeriodOptions();
const DEFAULT_PERIOD = PERIOD_OPTIONS[1]?.key || "all";

// ── COMPONENTS ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { color: "#6b7280", bg: "#f9fafb", label: status };
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      padding: "4px 10px", borderRadius: 20, fontSize: 12,
      fontWeight: 600, color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}22`, whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function PriorityIcon({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || { color: "#6b7280", icon: "·" };
  return <span style={{ color: cfg.color, fontWeight: 700, fontSize: 14 }}>{cfg.icon}</span>;
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{ background: "white", border: "1px solid #f1f5f9", borderRadius: 14, padding: "20px 24px", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color, letterSpacing: "-0.02em" }}>{value}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#374151", marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BucketCard({ label, color, total, done, inProgress, onClick, active, problem, what_we_are_doing, why_now }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const hasDetail = problem || what_we_are_doing || why_now;
  return (
    <div
      onClick={onClick}
      style={{
        background: "white",
        border: `1px solid ${active ? color : "#f1f5f9"}`,
        borderRadius: 14,
        cursor: "pointer",
        transition: "all 0.2s ease",
        boxShadow: active ? `0 0 0 3px ${color}22, 0 4px 12px rgba(0,0,0,0.06)` : "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: color, width: "100%" }} />

      <div style={{ padding: "16px 18px" }}>
        {/* Top row: label + count */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#1e293b", lineHeight: 1.4, maxWidth: "76%", paddingRight: 4 }}>{label}</div>
          <div style={{ fontSize: 24, fontWeight: 800, color, flexShrink: 0, letterSpacing: "-0.02em" }}>{total}</div>
        </div>

        {/* Progress bar */}
        <div style={{ background: "#f1f5f9", borderRadius: 6, height: 5, marginBottom: 10, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 6, transition: "width 0.4s" }} />
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#64748b" }}>
          <span>{pct}% done</span>
          <span>{inProgress} active</span>
        </div>

        {/* Expandable detail */}
        {active && hasDetail && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${color}22` }}>
            {problem && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Problem</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{problem}</div>
              </div>
            )}
            {what_we_are_doing && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>What we're doing</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{what_we_are_doing}</div>
              </div>
            )}
            {why_now && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 4 }}>Why now</div>
                <div style={{ fontSize: 13, color: "#374151", lineHeight: 1.6 }}>{why_now}</div>
              </div>
            )}
          </div>
        )}

        {/* Expand hint */}
        {!active && hasDetail && (
          <div style={{ marginTop: 10, fontSize: 12, color: color, fontWeight: 500, opacity: 0.7 }}>Click to expand ↓</div>
        )}
      </div>
    </div>
  );
}

function EpicCard({ epic, defaultOpen, jiraBase }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ background: "#f9f7fc", border: "1px solid #ede9f3", borderRadius: 10, overflow: "hidden" }}>
      <div onClick={() => setOpen(v => !v)}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 16px", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14, color: "#7C3AED", transition: "transform 0.2s", display: "inline-block", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
          <a href={`${jiraBase}/browse/${epic.key}`} target="_blank" rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 11, fontWeight: 700, color: "#7C3AED", fontFamily: "monospace", textDecoration: "none" }}>{epic.key}</a>
          <span style={{ fontSize: 14, fontWeight: 700, color: "#1e1b4b" }}>{epic.name}</span>
        </div>
        {!open && <span style={{ fontSize: 12, color: "#9ca3af", fontWeight: 600, flexShrink: 0 }}>{epic.tickets.length} tickets</span>}
      </div>
      {open && (
        <div style={{ padding: "0 16px 14px" }}>
          <div style={{ fontSize: 13, color: "#6b7280", marginBottom: 8 }}>
            {epic.tickets.length} tickets rolling up — {epic.doneCount} done, {epic.activeCount} in progress, {epic.tickets.length - epic.doneCount - epic.activeCount} queued
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {epic.tickets.slice(0, 6).map(t => (
              <a key={t.key} href={`${jiraBase}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                title={t.description || t.summary}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 5, borderRadius: 6, padding: "3px 8px", textDecoration: "none", fontSize: 11, lineHeight: 1.4,
                  background: t.status === "Done" ? "#f0fdf4" : ["In Progress", "In Review"].includes(t.status) ? "#eff6ff" : "#f9fafb",
                  border: `1px solid ${t.status === "Done" ? "#bbf7d0" : ["In Progress", "In Review"].includes(t.status) ? "#bfdbfe" : "#e5e7eb"}`,
                }}>
                <span style={{ fontWeight: 700, fontFamily: "monospace", color: t.status === "Done" ? "#22c55e" : ["In Progress", "In Review"].includes(t.status) ? "#3b82f6" : "#9ca3af" }}>{t.key}</span>
                <span style={{ color: "#374151" }}>{truncate(t.summary, 40)}</span>
              </a>
            ))}
            {epic.tickets.length > 6 && <span style={{ fontSize: 11, color: "#9ca3af", padding: "3px 8px" }}>+{epic.tickets.length - 6} more</span>}
          </div>
        </div>
      )}
    </div>
  );
}

const TYPE_COLORS = {
  Epic: "#6366f1", Story: "#22c55e", Bug: "#ef4444", Task: "#3b82f6", "Sub-task": "#94a3b8",
};

const ALL_COLUMNS = [
  { id: "ticket",   label: "Ticket",         width: 100 },
  { id: "type",     label: "Type",           width: 70 },
  { id: "summary",  label: "Summary / Epic", width: undefined },
  { id: "parent",   label: "Parent",         width: 140 },
  { id: "area",     label: "Area",           width: 40 },
  { id: "status",   label: "Status",         width: 160 },
  { id: "priority", label: "Priority",       width: 80 },
  { id: "assignee", label: "Assignee",       width: 110 },
  { id: "updated",  label: "Updated",        width: 80 },
];

const DEFAULT_COL_ORDER = ALL_COLUMNS.map(c => c.id);

function renderCell(colId, ticket, bucketRules) {
  const typeColor = TYPE_COLORS[ticket.issueType] || "#6b7280";
  switch (colId) {
    case "ticket":
      return (
        <a href={`${JIRA_BASE_URL}/browse/${ticket.key}`} target="_blank" rel="noopener noreferrer"
          style={{ color: "#7C3AED", textDecoration: "none", fontSize: 13, fontWeight: 600, fontFamily: "monospace" }}>
          {ticket.key}
        </a>
      );
    case "summary":
      return (
        <>
          <div style={{ fontSize: 14, color: "#1e293b", lineHeight: 1.5 }}>{ticket.summary}</div>
          {ticket.epic && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 3 }}>{ticket.epic}</div>}
        </>
      );
    case "type":
      return <span style={{ fontSize: 12, fontWeight: 600, color: typeColor }}>{ticket.issueType}</span>;
    case "parent":
      return ticket.parentKey ? (
        <a href={`${JIRA_BASE_URL}/browse/${ticket.parentKey}`} target="_blank" rel="noopener noreferrer"
          style={{ textDecoration: "none", fontSize: 12, color: "#64748b", lineHeight: 1.4 }}>
          <span style={{ fontFamily: "monospace", fontWeight: 600, color: "#94a3b8" }}>{ticket.parentKey}</span>
          {ticket.parentName && <span style={{ marginLeft: 4 }}>{ticket.parentName.length > 30 ? ticket.parentName.slice(0, 30) + "…" : ticket.parentName}</span>}
        </a>
      ) : <span style={{ fontSize: 12, color: "#d1d5db" }}>—</span>;
    case "area":
      return (
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: bucketRules.find(b => b.label === ticket.bucket)?.color || "#e2e8f0",
          margin: "0 auto",
        }} />
      );
    case "status":
      return <StatusBadge status={ticket.status} />;
    case "priority":
      return (
        <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <PriorityIcon priority={ticket.priority} />
          <span style={{ fontSize: 13, color: "#64748b" }}>{ticket.priority}</span>
        </div>
      );
    case "assignee":
      return <span style={{ fontSize: 13, color: "#64748b" }}>{ticket.assignee || "—"}</span>;
    case "updated":
      return <span style={{ fontSize: 13, color: "#94a3b8" }}>
        {ticket.updated ? new Date(ticket.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
      </span>;
    default: return null;
  }
}

function TicketRow({ ticket, isNew, bucketRules, columns }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9", background: isNew ? "#fefce8" : "white", transition: "background 0.15s" }}>
      {columns.map(col => (
        <td key={col.id} style={{ padding: "14px 16px", width: col.width }}>
          {renderCell(col.id, ticket, bucketRules)}
        </td>
      ))}
    </tr>
  );
}

function truncate(str, max = 60) {
  if (str.length <= max) return str;
  // Cut at last space before max to avoid mid-word truncation
  const cut = str.lastIndexOf(" ", max);
  return str.slice(0, cut > 0 ? cut : max) + "…";
}

// Clean a title: strip prefixes like "bE >", "FE >", "[Quality]", ticket keys
function cleanTitle(raw) {
  return raw
    .replace(/\[.*?\]\s*/g, "")              // [Quality], [Scheduling], etc.
    .replace(/^[a-zA-Z]{1,3}\s*>\s*/g, "")   // "bE >", "FE >", "BE >"
    .replace(/^[A-Z]+-\d+\s*[-:>]?\s*/g, "") // "SB-1234 -" or "SB-1234:"
    .trim();
}

// Try to apply gerund form to a phrase
function applyGerund(s) {
  const verbs = [
    [/^Add\b/i,"adding"],[/^Update\b/i,"updating"],[/^Fix\b/i,"fixing"],[/^Create\b/i,"creating"],
    [/^Remove\b/i,"removing"],[/^Implement\b/i,"implementing"],[/^Validate\b/i,"validating"],
    [/^Migrate\b/i,"migrating"],[/^Refactor\b/i,"refactoring"],[/^Investigate\b/i,"investigating"],
    [/^Set up\b/i,"setting up"],[/^Build\b/i,"building"],[/^Enable\b/i,"enabling"],
    [/^Configure\b/i,"configuring"],[/^Ensure\b/i,"ensuring"],[/^Track\b/i,"tracking"],
    [/^Clean\b/i,"cleaning up"],[/^Improve\b/i,"improving"],[/^Optimize\b/i,"optimizing"],
    [/^Define\b/i,"defining"],[/^Review\b/i,"reviewing"],[/^Test\b/i,"testing"],
    [/^Document\b/i,"documenting"],[/^Resolve\b/i,"resolving"],[/^Replace\b/i,"replacing"],
    [/^Audit\b/i,"auditing"],[/^Align\b/i,"aligning"],[/^Deprecate\b/i,"deprecating"],
    [/^Instrument\b/i,"instrumenting"],[/^Map\b/i,"mapping"],[/^Verify\b/i,"verifying"],
    [/^Send\b/i,"sending"],[/^Move\b/i,"moving"],[/^Integrate\b/i,"integrating"],
    [/^Support\b/i,"supporting"],[/^Handle\b/i,"handling"],[/^Identify\b/i,"identifying"],
    [/^Consolidate\b/i,"consolidating"],[/^Standardize\b/i,"standardizing"],
    [/^Introduce\b/i,"introducing"],[/^Automate\b/i,"automating"],
  ];
  for (const [pat, repl] of verbs) {
    if (pat.test(s)) return { text: s.replace(pat, repl), matched: true };
  }
  return { text: s, matched: false };
}

// Build a natural-language phrase from a ticket's summary + description.
// verbose=false: short phrase from title only. verbose=true: title + description context.
function toGerundPhrase(summary, description, verbose = false) {
  const title = cleanTitle(summary);

  // Build the base phrase from the title
  let base;
  const gTitle = applyGerund(title);
  if (gTitle.matched) {
    base = gTitle.text;
  } else if (description) {
    const firstSent = description.match(/^[^.!?]+/);
    if (firstSent) {
      const cleaned = cleanTitle(firstSent[0]).trim();
      if (cleaned.length > 10 && cleaned.length < 80) {
        const gDesc = applyGerund(cleaned);
        if (gDesc.matched) { base = gDesc.text; }
      }
    }
  }
  if (!base) base = "working on " + (title.charAt(0).toLowerCase() + title.slice(1));

  // In succinct mode, just return the base phrase
  if (!verbose) return base;

  // In verbose mode, enrich with description context
  if (description) {
    const sentences = description.match(/[^.!?]+[.!?]+/g);
    if (sentences) {
      // Grab first sentence that adds info beyond the title
      const titleLower = title.toLowerCase();
      const extra = sentences.find(s => {
        const sTrim = s.trim().toLowerCase();
        // Skip sentences that basically repeat the title
        return sTrim.length > 15 && !titleLower.includes(sTrim.replace(/[.!?]+$/, "").trim());
      });
      if (extra) {
        const trimmed = extra.trim();
        // Lower-case the first char to flow naturally after the dash
        const appended = trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        return `${base} — ${appended}`;
      }
    }
  }
  return base;
}

function joinList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];
}

// Extract first 1-2 sentences from a description string
function firstSentences(desc, max = 2) {
  if (!desc) return null;
  const sentences = desc.match(/[^.!?]+[.!?]+/g);
  if (!sentences) return desc.length > 150 ? desc.slice(0, 150) + "…" : desc;
  return sentences.slice(0, max).join(" ").trim();
}

function generateWeeklyInsights(dateFiltered, bucketStats, period, mode = "succinct") {
  if (!dateFiltered.length) return null;
  const verbose = mode === "verbose";
  const isFuture = period?.future === true;

  const byUpdated = (a, b) => new Date(b.updated) - new Date(a.updated);

  const shipped = dateFiltered
    .filter(t => t.status === "Done")
    .sort(byUpdated)
    .slice(0, 8)
    .map(t => ({ key: t.key, summary: truncate(t.summary), description: t.description }));

  const active = dateFiltered
    .filter(t => ["In Progress", "In Review"].includes(t.status))
    .sort(byUpdated)
    .slice(0, 8)
    .map(t => ({ key: t.key, summary: truncate(t.summary), description: t.description }));

  const needsDecision = dateFiltered
    .filter(t => t.status === "Investigation Required")
    .map(t => ({ key: t.key, summary: truncate(t.summary), description: t.description }));

  // Group tickets by parent epic
  const epicGroups = {};
  dateFiltered.forEach(t => {
    if (!t.parentName || !t.parentKey) return;
    if (!epicGroups[t.parentKey]) epicGroups[t.parentKey] = { name: t.parentName, key: t.parentKey, tickets: [], doneCount: 0, activeCount: 0 };
    epicGroups[t.parentKey].tickets.push(t);
    if (t.status === "Done") epicGroups[t.parentKey].doneCount++;
    if (["In Progress", "In Review"].includes(t.status)) epicGroups[t.parentKey].activeCount++;
  });

  // For future periods, include any epic with ≥1 ticket (they won't have many children in the filtered set)
  const epicThreshold = isFuture ? 0 : 3;
  const significantEpics = Object.values(epicGroups)
    .filter(g => g.tickets.length > epicThreshold)
    .sort((a, b) => b.tickets.length - a.tickets.length);

  // Also include standalone epic tickets that didn't group (e.g. epic with no children in this period)
  if (isFuture) {
    dateFiltered.forEach(t => {
      if (t.issueType === "Epic" && !epicGroups[t.key]) {
        significantEpics.push({ name: t.summary, key: t.key, tickets: [t], doneCount: 0, activeCount: 0 });
      }
    });
  }

  // Find the epic ticket itself (for its description)
  const epicTicketMap = {};
  dateFiltered.forEach(t => {
    if (t.issueType === "Epic") epicTicketMap[t.key] = t;
  });

  const topBullets = [];
  const totalDone = dateFiltered.filter(t => t.status === "Done").length;
  const totalActive = dateFiltered.filter(t => ["In Progress", "In Review"].includes(t.status)).length;
  const totalBlocked = dateFiltered.filter(t => t.status === "Investigation Required").length;
  const totalQueued = dateFiltered.filter(t => ["To Do", "Backlog"].includes(t.status)).length;

  // 1) Ticket counts
  if (isFuture) {
    const epicCount = dateFiltered.filter(t => t.issueType === "Epic").length;
    const nonEpic = dateFiltered.length - epicCount;
    if (epicCount > 0 && nonEpic > 0) {
      topBullets.push(`We have ${dateFiltered.length} items planned this period — ${epicCount} epics and ${nonEpic} tickets.`);
    } else if (epicCount > 0) {
      topBullets.push(`We have ${epicCount} epic${epicCount > 1 ? "s" : ""} planned for this period.`);
    } else {
      topBullets.push(`We have ${dateFiltered.length} tickets planned for this period.`);
    }
  } else if (verbose) {
    let countParts = [`${totalDone} shipped`, `${totalActive} in progress`];
    if (totalBlocked > 0) countParts.push(`${totalBlocked} needing investigation`);
    if (totalQueued > 0) countParts.push(`${totalQueued} queued`);
    topBullets.push(`We have ${dateFiltered.length} tickets this period — ${joinList(countParts)}.`);
  } else {
    topBullets.push(`We have ${dateFiltered.length} tickets this period — ${totalDone} shipped and ${totalActive} in progress.`);
  }

  // 2) Primary focus / planned initiatives
  if (significantEpics.length > 0) {
    const top = significantEpics[0];
    const epicTicket = epicTicketMap[top.key];
    const goal = firstSentences(epicTicket?.description);
    if (isFuture) {
      if (goal) {
        topBullets.push(`We're planning to focus on ${top.name} — ${goal}`);
      } else {
        topBullets.push(`We're planning to focus on ${top.name}.`);
      }
      if (significantEpics.length > 1) {
        const others = significantEpics.slice(1).map(e => e.name);
        topBullets.push(`We also have ${joinList(others)} planned.`);
      }
    } else if (verbose) {
      if (goal) {
        topBullets.push(`Our primary focus is ${top.name} (${top.tickets.length} tickets, ${top.doneCount} done, ${top.activeCount} active) — ${goal}`);
      } else {
        topBullets.push(`Our primary focus is ${top.name} with ${top.tickets.length} tickets rolling up — ${top.doneCount} shipped, ${top.activeCount} actively in progress, and ${top.tickets.length - top.doneCount - top.activeCount} queued.`);
      }
      if (significantEpics.length > 1) {
        const others = significantEpics.slice(1).map(e => `${e.name} (${e.tickets.length} tickets)`);
        topBullets.push(`We're also investing in ${joinList(others)}.`);
      }
    } else {
      if (goal) {
        topBullets.push(`Our primary focus is ${top.name} (${top.tickets.length} tickets) — ${goal}`);
      } else {
        topBullets.push(`Our primary focus is ${top.name} with ${top.tickets.length} tickets rolling up, ${top.doneCount} done and ${top.activeCount} actively in progress.`);
      }
    }
  }

  // 3) Upcoming work
  const queued = bucketStats.filter(b => b.done === 0 && b.inProgress === 0 && b.total > 0);
  if (queued.length > 0) {
    topBullets.push(`We have upcoming work queued in ${queued.map(q => q.label).join(", ")}.`);
  }

  // Per-epic insight bullets (label: detail format for bold splitting)
  const epicBullets = [];
  const activeLimit = verbose ? 5 : 3;
  const doneInlineLimit = verbose ? 5 : 3;
  const upcomingLimit = verbose ? 3 : 2;

  significantEpics.forEach(epic => {
    const epicTicket = epicTicketMap[epic.key];
    const goal = firstSentences(epicTicket?.description);

    if (isFuture) {
      // Future periods: describe what's planned, using the epic description
      const parts = [];
      if (goal) {
        parts.push(`we're planning to ${goal.charAt(0).toLowerCase()}${goal.slice(1).replace(/\.$/, "")}`);
      }
      const childCount = epic.tickets.filter(t => t.key !== epic.key).length;
      if (childCount > 0) {
        parts.push(`${childCount} ticket${childCount > 1 ? "s" : ""} scoped so far`);
      }
      epicBullets.push({ label: `In ${epic.name}`, detail: parts.length > 0 ? `${parts.join("; ")}.` : "planned for this period." });
    } else {
      const activeChildren = epic.tickets.filter(t => ["In Progress", "In Review"].includes(t.status) && t.key !== epic.key);
      const doneChildren = epic.tickets.filter(t => t.status === "Done" && t.key !== epic.key);
      const upcomingChildren = epic.tickets.filter(t => ["To Do", "Backlog"].includes(t.status));

      const parts = [];

      // Verbose: lead with epic goal if available
      if (verbose && goal) {
        parts.push(`the goal is to ${goal.charAt(0).toLowerCase()}${goal.slice(1).replace(/\.$/, "")}`);
      }

      if (activeChildren.length > 0) {
        const shown = activeChildren.slice(0, activeLimit);
        const phrases = shown.map(t => toGerundPhrase(t.summary, t.description, verbose));
        let activePart = `we're ${joinList(phrases)}`;
        if (activeChildren.length > activeLimit) activePart += ` and ${activeChildren.length - activeLimit} more`;
        parts.push(activePart);
      }
      if (doneChildren.length > 0 && doneChildren.length <= doneInlineLimit) {
        const phrases = doneChildren.map(t => toGerundPhrase(t.summary, t.description, verbose));
        parts.push(`we've completed ${joinList(phrases)}`);
      } else if (doneChildren.length > doneInlineLimit) {
        if (verbose) {
          const sample = doneChildren.slice(0, 3).map(t => toGerundPhrase(t.summary, t.description, verbose));
          parts.push(`we've completed ${doneChildren.length} items including ${joinList(sample)}`);
        } else {
          parts.push(`we've completed ${doneChildren.length} items`);
        }
      }
      if (upcomingChildren.length > 0) {
        const shown = upcomingChildren.slice(0, upcomingLimit);
        const phrases = shown.map(t => toGerundPhrase(t.summary, t.description, verbose));
        let upPart = `up next we'll be ${joinList(phrases)}`;
        if (verbose && upcomingChildren.length > upcomingLimit) upPart += ` and ${upcomingChildren.length - upcomingLimit} more`;
        parts.push(upPart);
      }

      if (parts.length > 0) {
        epicBullets.push({ label: `In ${epic.name}`, detail: `${parts.join("; ")}.` });
      }
    }
  });

  // One-off bucket notes (same level as top bullets)
  const oneOffBullets = [];
  const significantEpicKeys = new Set(significantEpics.map(e => e.key));
  const orphanInlineLimit = verbose ? 4 : 3;
  const orphanSampleLimit = verbose ? 3 : 2;

  bucketStats.forEach(b => {
    const orphans = dateFiltered.filter(t =>
      t.bucket === b.label &&
      t.issueType !== "Epic" &&
      (!t.parentKey || !significantEpicKeys.has(t.parentKey))
    );
    if (orphans.length > 0 && orphans.length <= orphanInlineLimit) {
      const items = orphans.map(t => toGerundPhrase(t.summary, t.description, verbose));
      oneOffBullets.push(`In ${b.label}, we're ${joinList(items)}.`);
    } else if (orphans.length > orphanInlineLimit) {
      const sample = orphans.slice(0, orphanSampleLimit).map(t => toGerundPhrase(t.summary, t.description, verbose));
      oneOffBullets.push(`In ${b.label}, we're ${joinList(sample)}, plus ${orphans.length - orphanSampleLimit} more items.`);
    }
  });

  return { topBullets, epicBullets, oneOffBullets, shipped, active, needsDecision, significantEpics };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tickets, setTickets]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [lastFetched, setLastFetched]   = useState(null);
  const jqlKey = `sqt-jql${SHEET_ID ? `-${SHEET_ID}` : ""}`;
  const [jql, _setJql]                  = useState(() => {
    const saved = localStorage.getItem(jqlKey);
    return saved || DEFAULT_JQL;
  });
  const setJql = (v) => { _setJql(v); localStorage.setItem(jqlKey, typeof v === "function" ? v(jql) : v); };
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterBucket, setFilterBucket] = useState(null);
  const [search, setSearch]             = useState("");
  const [newKeys, setNewKeys]           = useState(new Set());
  const [showJql, setShowJql]           = useState(false);
  const [periodKey, setPeriodKey]       = useState(DEFAULT_PERIOD);
  const [bucketRules, setBucketRules]   = useState([]);
  const [columnOrder, setColumnOrder]   = useState(() => {
    try { return JSON.parse(localStorage.getItem("sqt-col-order")) || DEFAULT_COL_ORDER; } catch { return DEFAULT_COL_ORDER; }
  });
  const [hiddenCols, setHiddenCols]     = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem("sqt-hidden-cols")) || []); } catch { return new Set(); }
  });
  const [showColMenu, setShowColMenu]   = useState(false);
  const [periodsExpanded, setPeriodsExpanded] = useState(false);
  const [summaryMode, setSummaryMode]         = useState("succinct");
  const [dragCol, setDragCol]           = useState(null);
  const colMenuRef = useRef(null);

  useEffect(() => {
    if (!showColMenu) return;
    const handleClick = (e) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target)) setShowColMenu(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showColMenu]);

  const visibleColumns = columnOrder.filter(id => !hiddenCols.has(id)).map(id => ALL_COLUMNS.find(c => c.id === id)).filter(Boolean);

  const toggleColumn = (id) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      localStorage.setItem("sqt-hidden-cols", JSON.stringify([...next]));
      return next;
    });
  };

  const handleDragStart = (colId) => setDragCol(colId);
  const handleDragOver = (e, colId) => {
    e.preventDefault();
    if (!dragCol || dragCol === colId) return;
    setColumnOrder(prev => {
      const next = [...prev];
      const fromIdx = next.indexOf(dragCol);
      const toIdx = next.indexOf(colId);
      next.splice(fromIdx, 1);
      next.splice(toIdx, 0, dragCol);
      localStorage.setItem("sqt-col-order", JSON.stringify(next));
      return next;
    });
  };
  const handleDragEnd = () => setDragCol(null);

  const fetchBuckets = useCallback(async () => {
    try {
      const bucketUrl = SHEET_ID ? `/api/buckets?sheet=${SHEET_ID}` : "/api/buckets";
      const res = await fetch(bucketUrl);
      if (res.ok) {
        const data = await res.json();
        setBucketRules(data);
        return data;
      }
    } catch {
      // silent — buckets are optional
    }
    return bucketRules;
  }, []);

  useEffect(() => { fetchBuckets(); }, []);

  const fetchTickets = useCallback(async () => {
    if (!JIRA_EMAIL || !JIRA_TOKEN) {
      setError("Missing Jira credentials. Set VITE_JIRA_EMAIL and VITE_JIRA_API_TOKEN in Vercel environment variables.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const latestBuckets = await fetchBuckets();
      const rules = latestBuckets.length ? latestBuckets : bucketRules;

      const prevKeys = new Set(tickets.map(t => t.key));
      const params   = new URLSearchParams({
        jql,
        fields: "summary,status,priority,assignee,updated,duedate,customfield_10252,customfield_10005,issuetype,parent,description",
      });
      const res = await fetch(`/api/jira?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.errorMessages?.join(", ") || `Error ${res.status}`);
      }
      const data   = await res.json();
      const parsed = (data.issues || []).map(issue => {
        const typeName = issue.fields.issuetype?.name || "Unknown";
        const isEpic = typeName.toLowerCase() === "epic";
        const descText = extractAdfText(issue.fields.description).trim();
        const t = {
          key:        issue.key,
          summary:    issue.fields.summary,
          description: descText ? descText.slice(0, 300) : null,
          status:     issue.fields.status?.name || "Unknown",
          priority:   issue.fields.priority?.name || "None",
          assignee:   issue.fields.assignee?.displayName || null,
          epic:       issue.fields.customfield_10005 || null,
          updated:    issue.fields.updated,
          duedate:    issue.fields.duedate || null,
          targetCompletion: parseTextDate(issue.fields.customfield_10252),
          issueType:  typeName,
          parentKey:  isEpic ? issue.key : (issue.fields.parent?.key || null),
          parentName: isEpic ? issue.fields.summary : (issue.fields.parent?.fields?.summary || null),
        };
        t.bucket = getBucket(t, rules);
        return t;
      });
      const fresh = new Set(parsed.filter(t => !prevKeys.has(t.key)).map(t => t.key));
      setNewKeys(fresh);
      setTimeout(() => setNewKeys(new Set()), 10000);
      setTickets(parsed);
      setLastFetched(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [jql, tickets, bucketRules, fetchBuckets]);

  const period = PERIOD_OPTIONS.find(p => p.key === periodKey);
  const dateFiltered = useMemo(() => {
    if (!period || periodKey === "all") return tickets;
    return tickets.filter(t => {
      const updatedYM = t.updated?.slice(0, 7);
      const dueYM = t.duedate?.slice(0, 7);
      const targetYM = t.targetCompletion; // already YYYY-MM from parseTextDate
      const updatedMatch = updatedYM && updatedYM >= period.startYM && updatedYM <= period.endYM;
      const dueMatch = dueYM && dueYM >= period.startYM && dueYM <= period.endYM;
      const targetMatch = targetYM && targetYM >= period.startYM && targetYM <= period.endYM;
      return updatedMatch || dueMatch || targetMatch;
    });
  }, [tickets, periodKey]);

  const bucketStats = bucketRules.map(b => {
    const items = dateFiltered.filter(t => t.bucket === b.label);
    return {
      ...b,
      total:      items.length,
      done:       items.filter(t => t.status === "Done").length,
      inProgress: items.filter(t => ["In Progress", "In Review"].includes(t.status)).length,
    };
  }).filter(b => b.total > 0);

  const otherItems = dateFiltered.filter(t => t.bucket === "Other");
  if (otherItems.length > 0) {
    bucketStats.push({
      label: "Other", color: "#94a3b8", keywords: [], problem: "", what_we_are_doing: "", why_now: "",
      total: otherItems.length,
      done: otherItems.filter(t => t.status === "Done").length,
      inProgress: otherItems.filter(t => ["In Progress","In Review"].includes(t.status)).length,
    });
  }

  const statuses     = ["All", ...new Set(dateFiltered.map(t => t.status).filter(Boolean))];
  const doneCount    = dateFiltered.filter(t => t.status === "Done").length;
  const activeCount  = dateFiltered.filter(t => ["In Progress","In Review"].includes(t.status)).length;
  const blockedCount = dateFiltered.filter(t => t.status === "Investigation Required").length;

  const weeklyInsights = useMemo(() => generateWeeklyInsights(dateFiltered, bucketStats, period, summaryMode), [dateFiltered, bucketStats, period, summaryMode]);

  const filtered = dateFiltered.filter(t => {
    const matchStatus = filterStatus === "All" || t.status === filterStatus;
    const matchBucket = !filterBucket || t.bucket === filterBucket;
    const matchSearch = !search ||
      t.summary.toLowerCase().includes(search.toLowerCase()) ||
      t.key.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchBucket && matchSearch;
  });

  const missingCreds = !JIRA_EMAIL || !JIRA_TOKEN;

  return (
    <div style={{ fontFamily: "'Montserrat','Inter','Helvetica Neue',sans-serif", background: "#faf9fb", minHeight: "100vh", padding: "0" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "white", borderBottom: "1px solid #ede9f3", padding: "20px 32px", marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ background: "#7C3AED", color: "white", borderRadius: 12, width: 44, height: 44, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, flexShrink: 0 }}>H</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "#1e1b4b", letterSpacing: "-0.01em" }}>Quality Work Dashboard</h1>
              {lastFetched && (
                <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>
                  Last synced: {lastFetched.toLocaleTimeString()} · {dateFiltered.length} tickets{periodKey !== "all" ? ` in ${period?.label}` : ""} · {bucketStats.length} areas
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <select
              onChange={e => { if (e.target.value) { setJql(buildJql(e.target.value)); } }}
              defaultValue=""
              style={{ border: "1px solid #e5e7eb", borderRadius: 20, padding: "8px 14px", fontSize: 13, fontWeight: 600, color: "#6b7280", background: "white", outline: "none", cursor: "pointer" }}>
              <option value="" disabled>Team…</option>
              {TEAM_PRESETS.map(t => (
                <option key={t.project} value={t.project}>{t.label}</option>
              ))}
            </select>
            <button onClick={() => setShowJql(v => !v)}
              style={{ background: "white", border: "1px solid #e5e7eb", borderRadius: 20, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer", color: "#6b7280", transition: "all 0.15s" }}>
              {showJql ? "Hide JQL" : "Edit JQL"}
            </button>
            <button onClick={fetchTickets} disabled={loading}
              style={{ background: loading ? "#e5e7eb" : "#7C3AED", color: loading ? "#9ca3af" : "white", border: "none", borderRadius: 20, padding: "8px 22px", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s" }}>
              {loading ? "Syncing…" : "⟳ Sync from Jira"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 clamp(24px, 3vw, 64px) 32px" }}>

      {/* ── PERIOD PICKER ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 28 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#374151", flexShrink: 0 }}>Period:</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, overflow: "hidden", flexWrap: periodsExpanded ? "wrap" : "nowrap" }}>
          {PERIOD_OPTIONS.slice(0, 13).map(p => (
            <button key={p.key} onClick={() => setPeriodKey(p.key)}
              style={{
                padding: "6px 16px", borderRadius: 20, fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0,
                border: periodKey === p.key ? "1.5px solid #7C3AED" : "1px solid #e5e7eb",
                background: periodKey === p.key ? "#7C3AED" : "white",
                color: periodKey === p.key ? "white" : "#6b7280",
                transition: "all 0.15s",
                boxShadow: periodKey === p.key ? "0 2px 6px rgba(124,58,237,0.25)" : "none",
              }}>
              {p.label}
            </button>
          ))}
          <select
            value={PERIOD_OPTIONS.findIndex(p => p.key === periodKey) >= 13 ? periodKey : ""}
            onChange={e => e.target.value && setPeriodKey(e.target.value)}
            style={{ border: "1px solid #e5e7eb", borderRadius: 20, padding: "6px 12px", fontSize: 13, color: "#6b7280", background: "white", outline: "none", cursor: "pointer", flexShrink: 0 }}>
            <option value="">More…</option>
            <optgroup label="Future">
              {PERIOD_OPTIONS.filter(p => p.future).map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </optgroup>
            <optgroup label="Quarters">
              {PERIOD_OPTIONS.filter(p => p.key.startsWith("Q")).map(p => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <button onClick={() => setPeriodsExpanded(v => !v)}
          style={{
            width: 30, height: 30, borderRadius: "50%", border: "1px solid #e5e7eb", background: "white",
            cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            fontSize: 14, color: "#6b7280", transition: "transform 0.2s", transform: periodsExpanded ? "rotate(90deg)" : "rotate(0deg)",
          }}>
          ›
        </button>
      </div>

      {/* ── CREDS WARNING ── */}
      {missingCreds && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 12, padding: "16px 20px", marginBottom: 20, fontSize: 14, color: "#92400e" }}>
          <strong>Setup required.</strong> Add in Vercel → Settings → Environment Variables:
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.9 }}>
            <li><code>VITE_JIRA_BASE_URL</code> = <code>https://joinhomebase.atlassian.net</code></li>
            <li><code>VITE_JIRA_EMAIL</code> = your Atlassian login email</li>
            <li><code>VITE_JIRA_API_TOKEN</code> = token from <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>id.atlassian.com → Security → API tokens</a></li>
          </ul>
        </div>
      )}

      {/* ── JQL EDITOR ── */}
      {showJql && (
        <div style={{ background: "#1e1b4b", borderRadius: 14, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 12, color: "#a78bfa", fontWeight: 600, marginBottom: 10, letterSpacing: "0.05em" }}>JQL QUERY</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={jql} onChange={e => setJql(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchTickets()}
              style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 14px", color: "#94a3b8", fontSize: 13, fontFamily: "monospace", outline: "none" }} />
            <button onClick={fetchTickets} disabled={loading}
              style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Run
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 12, padding: "16px 20px", marginBottom: 20, fontSize: 14, color: "#dc2626" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── LOADING ── */}
      {loading && (
        <div style={{ background: "white", border: "1px solid #f1f5f9", borderRadius: 16, padding: "56px 24px", textAlign: "center", marginBottom: 24, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
          <div style={{ width: 220, height: 5, background: "#f1f5f9", borderRadius: 6, margin: "0 auto 20px", overflow: "hidden" }}>
            <div style={{
              width: "40%", height: "100%", background: "#7C3AED", borderRadius: 6,
              animation: "loading 1.2s ease-in-out infinite",
            }} />
          </div>
          <style>{`@keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#374151" }}>Syncing from Jira…</div>
          <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>Fetching all matching tickets</div>
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!loading && tickets.length === 0 && !error && (
        <div style={{ background: "white", border: "2px dashed #e2e8f0", borderRadius: 16, padding: "64px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🎯</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#374151", marginBottom: 8 }}>No tickets loaded yet</div>
          <div style={{ fontSize: 14, color: "#94a3b8" }}>Hit "Sync from Jira" to get started.</div>
        </div>
      )}

      {tickets.length > 0 && (
        <>
          {/* ── SECTION 1: SUMMARY STATS ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 16, marginBottom: 32 }}>
            <SummaryCard label="Total tickets"        value={dateFiltered.length} color="#7C3AED" />
            <SummaryCard label="Shipped / done"       value={doneCount}           color="#22c55e" sub={dateFiltered.length ? `${Math.round(doneCount/dateFiltered.length*100)}% complete` : "—"} />
            <SummaryCard label="In progress"          value={activeCount}         color="#3b82f6" />
            <SummaryCard label="Needs investigation"  value={blockedCount}        color="#f59e0b" />
            {newKeys.size > 0 && <SummaryCard label="New this sync" value={newKeys.size} color="#a855f7" sub="Highlighted below" />}
          </div>

          {/* ── SECTION 2: BUCKET CARDS ── */}
          <div style={{ marginBottom: 32 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#1e1b4b" }}>Quality Areas</div>
                <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 4 }}>Click a card to see context and filter tickets · Buckets updated each cycle from Signal Scout and manually reviewed by PM to ensure accuracy</div>
              </div>
              {filterBucket && (
                <button onClick={() => setFilterBucket(null)}
                  style={{ fontSize: 13, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  ✕ Clear filter
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))", gap: 16 }}>
              {bucketStats.map(b => (
                <BucketCard
                  key={b.label}
                  {...b}
                  active={filterBucket === b.label}
                  onClick={() => setFilterBucket(filterBucket === b.label ? null : b.label)}
                />
              ))}
            </div>
          </div>

          {/* ── SECTION 3: PERIOD SUMMARY ── */}
          <div style={{ background: "white", border: "1px solid #f1f5f9", borderRadius: 14, padding: "24px 28px", marginBottom: 32, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: "#1e1b4b" }}>Period Summary</span>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 8, padding: 2 }}>
                  {["succinct", "verbose"].map(mode => (
                    <button key={mode} onClick={() => setSummaryMode(mode)}
                      style={{
                        padding: "4px 12px", fontSize: 12, fontWeight: 600, borderRadius: 6, border: "none", cursor: "pointer", textTransform: "capitalize",
                        background: summaryMode === mode ? "white" : "transparent",
                        color: summaryMode === mode ? "#7C3AED" : "#9ca3af",
                        boxShadow: summaryMode === mode ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
                        transition: "all 0.15s",
                      }}>
                      {mode}
                    </button>
                  ))}
                </div>
                <span style={{ fontSize: 13, color: "#9ca3af", fontWeight: 500 }}>{period?.label || "All Time"}</span>
              </div>
            </div>
            {!weeklyInsights ? (
              <p style={{ margin: 0, fontSize: 14, color: "#9ca3af" }}>Sync from Jira to generate insights.</p>
            ) : (
              <>
                <ul style={{ margin: 0, paddingLeft: 20, fontSize: 14, color: "#374151", lineHeight: 2, textAlign: "left" }}>
                  {weeklyInsights.topBullets.map((s, i) => <li key={i}>{s}</li>)}
                  {weeklyInsights.epicBullets.length > 0 && (
                    <li style={{ fontWeight: 700 }}>Epic Specific Summary:
                      <ul style={{ margin: 0, paddingLeft: 20, fontWeight: 400 }}>
                        {weeklyInsights.epicBullets.map((eb, i) => (
                          <li key={i}><strong>{eb.label}:</strong> {eb.detail}</li>
                        ))}
                      </ul>
                    </li>
                  )}
                  {weeklyInsights.oneOffBullets.map((s, i) => <li key={`o${i}`}>{s}</li>)}
                </ul>

                {/* Key Epics cards */}
                {weeklyInsights.significantEpics?.length > 0 && (
                      <div style={{ marginTop: 24, marginBottom: 20 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "#7C3AED", textTransform: "uppercase", marginBottom: 10 }}>Key Epics</div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                          {weeklyInsights.significantEpics.map(epic => (
                            <EpicCard key={epic.key} epic={epic} defaultOpen={weeklyInsights.significantEpics.length === 1} jiraBase={JIRA_BASE_URL} />
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Shipped / Active / Needs investigation */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      {weeklyInsights.shipped.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "#22c55e", textTransform: "uppercase", marginBottom: 8 }}>Shipped</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {weeklyInsights.shipped.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, padding: "8px 12px", textDecoration: "none", fontSize: 13, lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: "#22c55e", fontFamily: "monospace", flexShrink: 0 }}>{t.key}</span>
                            <span style={{ color: "#1e293b" }}>{t.summary}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {weeklyInsights.active.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "#3b82f6", textTransform: "uppercase", marginBottom: 8 }}>In Progress</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {weeklyInsights.active.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 8, padding: "8px 12px", textDecoration: "none", fontSize: 13, lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: "#3b82f6", fontFamily: "monospace", flexShrink: 0 }}>{t.key}</span>
                            <span style={{ color: "#1e293b" }}>{t.summary}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {weeklyInsights.needsDecision.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.05em", color: "#f59e0b", textTransform: "uppercase", marginBottom: 8 }}>Needs Investigation</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        {weeklyInsights.needsDecision.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: "8px 12px", textDecoration: "none", fontSize: 13, lineHeight: 1.5 }}>
                            <span style={{ fontWeight: 700, color: "#f59e0b", fontFamily: "monospace", flexShrink: 0 }}>{t.key}</span>
                            <span style={{ color: "#1e293b" }}>{t.summary}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* ── SECTION 4: TICKET TABLE ── */}
          <div style={{ background: "white", borderRadius: 16, border: "1px solid #f1f5f9", overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#1e1b4b" }}>
                All Tickets
                {filterBucket && <span style={{ fontSize: 14, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>— {filterBucket}</span>}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                  style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 14px", fontSize: 13, outline: "none", width: 180, background: "white", color: "#1e293b" }} />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 12px", fontSize: 13, outline: "none", background: "white", color: "#1e293b" }}>
                  {statuses.map(s => <option key={s}>{s}</option>)}
                </select>
                <div ref={colMenuRef} style={{ position: "relative" }}>
                  <button onClick={() => setShowColMenu(v => !v)}
                    style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "8px 14px", fontSize: 13, fontWeight: 600, background: showColMenu ? "#f1f5f9" : "white", color: "#64748b", cursor: "pointer", transition: "all 0.15s" }}>
                    Columns
                  </button>
                  {showColMenu && (
                    <div style={{
                      position: "absolute", top: "100%", right: 0, marginTop: 6, background: "white",
                      border: "1px solid #e2e8f0", borderRadius: 12, padding: 10, zIndex: 20,
                      boxShadow: "0 8px 24px rgba(0,0,0,0.1)", minWidth: 190,
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.05em", padding: "6px 10px", textTransform: "uppercase" }}>Show / hide</div>
                      {ALL_COLUMNS.map(col => (
                        <label key={col.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", fontSize: 13, color: "#374151", cursor: "pointer", borderRadius: 6 }}>
                          <input type="checkbox" checked={!hiddenCols.has(col.id)} onChange={() => toggleColumn(col.id)}
                            style={{ accentColor: "#7C3AED" }} />
                          {col.label}
                        </label>
                      ))}
                      <div style={{ borderTop: "1px solid #f1f5f9", marginTop: 6, paddingTop: 6 }}>
                        <button onClick={() => { setColumnOrder(DEFAULT_COL_ORDER); setHiddenCols(new Set()); localStorage.removeItem("sqt-col-order"); localStorage.removeItem("sqt-hidden-cols"); }}
                          style={{ fontSize: 12, color: "#7C3AED", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: "4px 10px" }}>
                          Reset to default
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <span style={{ fontSize: 13, color: "#94a3b8" }}>{filtered.length} of {dateFiltered.length}</span>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f9f7fc", borderBottom: "1px solid #ede9f3" }}>
                    {visibleColumns.map(col => (
                      <th key={col.id}
                        draggable
                        onDragStart={() => handleDragStart(col.id)}
                        onDragOver={(e) => handleDragOver(e, col.id)}
                        onDragEnd={handleDragEnd}
                        style={{
                          padding: "12px 16px", textAlign: "left", fontSize: 12, fontWeight: 700,
                          color: "#64748b", letterSpacing: "0.05em", whiteSpace: "nowrap",
                          cursor: "grab", userSelect: "none", textTransform: "uppercase",
                          background: dragCol === col.id ? "#e2e8f0" : "transparent",
                          transition: "background 0.15s",
                        }}>
                        <span style={{ opacity: 0.3, marginRight: 5, fontSize: 11 }}>⠿</span>{col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={visibleColumns.length} style={{ padding: 48, textAlign: "center", color: "#94a3b8", fontSize: 14 }}>No tickets match your filters</td></tr>
                    : filtered.map(t => <TicketRow key={t.key} ticket={t} isNew={newKeys.has(t.key)} bucketRules={bucketRules} columns={visibleColumns} />)
                  }
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}
