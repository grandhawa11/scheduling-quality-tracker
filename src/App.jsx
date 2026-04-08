import { useState, useCallback, useMemo, useEffect } from "react";

const JIRA_BASE_URL = import.meta.env.VITE_JIRA_BASE_URL || "https://joinhomebase.atlassian.net";
const JIRA_EMAIL    = import.meta.env.VITE_JIRA_EMAIL    || "";
const JIRA_TOKEN    = import.meta.env.VITE_JIRA_API_TOKEN || "";

const DEFAULT_JQL =
  'project = "SB" AND (labels = "Quality" OR Allocation = "Quality Improvements" OR summary ~ "[Quality]") ORDER BY status ASC, updated DESC';

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
  const opts = [{ key: "all", label: "All Time" }];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth();
    opts.push({
      key: `${y}-${String(m + 1).padStart(2, "0")}`,
      label: `${MONTH_NAMES[m]}${y !== now.getFullYear() ? " " + y : ""}`,
      start: new Date(y, m, 1),
      end: new Date(y, m + 1, 0, 23, 59, 59, 999),
    });
  }
  for (const y of [now.getFullYear(), now.getFullYear() - 1]) {
    for (let q = 3; q >= 0; q--) {
      const sm = q * 3;
      const start = new Date(y, sm, 1);
      if (start > now) continue;
      opts.push({
        key: `Q${q + 1}-${y}`,
        label: `Q${q + 1} ${y} (${MONTH_NAMES[sm]}–${MONTH_NAMES[sm + 2]})`,
        start,
        end: new Date(y, sm + 3, 0, 23, 59, 59, 999),
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
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "2px 8px", borderRadius: 12, fontSize: 11,
      fontWeight: 600, color: cfg.color, background: cfg.bg,
      border: `1px solid ${cfg.color}22`, whiteSpace: "nowrap",
    }}>
      {cfg.label}
    </span>
  );
}

function PriorityIcon({ priority }) {
  const cfg = PRIORITY_CONFIG[priority] || { color: "#6b7280", icon: "·" };
  return <span style={{ color: cfg.color, fontWeight: 700, fontSize: 12 }}>{cfg.icon}</span>;
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 10, padding: "14px 18px" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#374151", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{sub}</div>}
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
        border: `1px solid ${active ? color : "#e2e8f0"}`,
        borderRadius: 10,
        cursor: "pointer",
        transition: "border-color 0.15s, box-shadow 0.15s",
        boxShadow: active ? `0 0 0 3px ${color}22` : "none",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Accent bar */}
      <div style={{ height: 3, background: color, width: "100%" }} />

      <div style={{ padding: "12px 14px" }}>
        {/* Top row: label + count */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", lineHeight: 1.3, maxWidth: "76%", paddingRight: 4 }}>{label}</div>
          <div style={{ fontSize: 20, fontWeight: 800, color, flexShrink: 0 }}>{total}</div>
        </div>

        {/* Progress bar */}
        <div style={{ background: "#f1f5f9", borderRadius: 4, height: 4, marginBottom: 8, overflow: "hidden" }}>
          <div style={{ width: `${pct}%`, background: color, height: "100%", borderRadius: 4, transition: "width 0.4s" }} />
        </div>

        {/* Stats row */}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#64748b" }}>
          <span>{pct}% done</span>
          <span>{inProgress} active</span>
        </div>

        {/* Expandable detail */}
        {active && hasDetail && (
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${color}22` }}>
            {problem && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Problem</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{problem}</div>
              </div>
            )}
            {what_we_are_doing && (
              <div style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>What we're doing</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{what_we_are_doing}</div>
              </div>
            )}
            {why_now && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>Why now</div>
                <div style={{ fontSize: 12, color: "#374151", lineHeight: 1.5 }}>{why_now}</div>
              </div>
            )}
          </div>
        )}

        {/* Expand hint */}
        {!active && hasDetail && (
          <div style={{ marginTop: 8, fontSize: 11, color: color, fontWeight: 500, opacity: 0.7 }}>Click to expand ↓</div>
        )}
      </div>
    </div>
  );
}

function TicketRow({ ticket, isNew, bucketRules }) {
  return (
    <tr style={{ borderBottom: "1px solid #f1f5f9", background: isNew ? "#fefce8" : "white" }}>
      <td style={{ padding: "10px 12px", width: 100 }}>
        <a href={`${JIRA_BASE_URL}/browse/${ticket.key}`} target="_blank" rel="noopener noreferrer"
          style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}>
          {ticket.key}
        </a>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.4 }}>{ticket.summary}</div>
        {ticket.epic && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{ticket.epic}</div>}
      </td>
      <td style={{ padding: "10px 12px", width: 40 }}>
        <div style={{
          width: 8, height: 8, borderRadius: "50%",
          background: bucketRules.find(b => b.label === ticket.bucket)?.color || "#e2e8f0",
          margin: "0 auto",
        }} />
      </td>
      <td style={{ padding: "10px 12px", width: 160 }}><StatusBadge status={ticket.status} /></td>
      <td style={{ padding: "10px 12px", width: 80 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <PriorityIcon priority={ticket.priority} />
          <span style={{ fontSize: 11, color: "#64748b" }}>{ticket.priority}</span>
        </div>
      </td>
      <td style={{ padding: "10px 12px", width: 110, fontSize: 11, color: "#94a3b8" }}>{ticket.assignee || "—"}</td>
      <td style={{ padding: "10px 12px", width: 80, fontSize: 11, color: "#94a3b8" }}>
        {ticket.updated ? new Date(ticket.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—"}
      </td>
    </tr>
  );
}

function truncate(str, max = 60) {
  return str.length > max ? str.slice(0, max) + "…" : str;
}

function generateWeeklyInsights(dateFiltered, bucketStats, period) {
  if (!dateFiltered.length) return null;

  const byUpdated = (a, b) => new Date(b.updated) - new Date(a.updated);

  const shipped = dateFiltered
    .filter(t => t.status === "Done")
    .sort(byUpdated)
    .slice(0, 5)
    .map(t => ({ key: t.key, summary: truncate(t.summary) }));

  const active = dateFiltered
    .filter(t => ["In Progress", "In Review"].includes(t.status))
    .sort(byUpdated)
    .slice(0, 5)
    .map(t => ({ key: t.key, summary: truncate(t.summary) }));

  const needsDecision = dateFiltered
    .filter(t => t.status === "Investigation Required")
    .map(t => ({ key: t.key, summary: truncate(t.summary) }));

  // Build summary sentence
  const parts = [];
  const topDone = [...bucketStats].sort((a, b) => b.done - a.done).filter(b => b.done > 0);
  if (topDone.length >= 2) {
    parts.push(`Good progress in ${topDone[0].label} and ${topDone[1].label} this period.`);
  } else if (topDone.length === 1) {
    parts.push(`Good progress in ${topDone[0].label} this period.`);
  }

  const topActive = [...bucketStats].sort((a, b) => b.inProgress - a.inProgress).filter(b => b.inProgress > 0);
  if (topActive.length > 0) {
    parts.push(`Active work underway in ${topActive[0].label}.`);
  }

  const queued = bucketStats.filter(b => b.done === 0 && b.inProgress === 0 && b.total > 0);
  if (queued.length > 0) {
    parts.push(`Upcoming work queued in ${queued[0].label}.`);
  }

  const summary = parts.length > 0 ? parts.join(" ") : `${dateFiltered.length} tickets in this period.`;

  return { summary, shipped, active, needsDecision };
}

// ── MAIN ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [tickets, setTickets]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [lastFetched, setLastFetched]   = useState(null);
  const [jql, setJql]                   = useState(DEFAULT_JQL);
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterBucket, setFilterBucket] = useState(null);
  const [search, setSearch]             = useState("");
  const [newKeys, setNewKeys]           = useState(new Set());
  const [showJql, setShowJql]           = useState(false);
  const [periodKey, setPeriodKey]       = useState(DEFAULT_PERIOD);
  const [bucketRules, setBucketRules]   = useState([]);

  const fetchBuckets = useCallback(async () => {
    try {
      const res = await fetch("/api/buckets");
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
        jql, maxResults: 100,
        fields: "summary,status,priority,assignee,updated,customfield_10005",
      });
      const res = await fetch(`/api/jira?${params}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.errorMessages?.join(", ") || `Error ${res.status}`);
      }
      const data   = await res.json();
      const parsed = (data.issues || []).map(issue => {
        const t = {
          key:      issue.key,
          summary:  issue.fields.summary,
          status:   issue.fields.status?.name || "Unknown",
          priority: issue.fields.priority?.name || "None",
          assignee: issue.fields.assignee?.displayName || null,
          epic:     issue.fields.customfield_10005 || null,
          updated:  issue.fields.updated,
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
      if (!t.updated) return false;
      const d = new Date(t.updated);
      return d >= period.start && d <= period.end;
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

  const weeklyInsights = useMemo(() => generateWeeklyInsights(dateFiltered, bucketStats, period), [dateFiltered, bucketStats, period]);

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
    <div style={{ fontFamily: "'IBM Plex Sans','Helvetica Neue',sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>

      {/* ── HEADER ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
            <div style={{ background: "#1e293b", color: "white", borderRadius: 6, padding: "3px 9px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>SCHEDULING</div>
            <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>QUALITY TRACKER</div>
          </div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>Quality work dashboard</h1>
          {lastFetched && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
              Last synced: {lastFetched.toLocaleTimeString()} · {dateFiltered.length} tickets{periodKey !== "all" ? ` in ${period?.label}` : ""} · {bucketStats.length} areas · Sheet updated each cycle
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowJql(v => !v)}
            style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: "8px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", color: "#64748b" }}>
            {showJql ? "Hide JQL" : "Edit JQL"}
          </button>
          <button onClick={fetchTickets} disabled={loading}
            style={{ background: loading ? "#e2e8f0" : "#1e293b", color: loading ? "#94a3b8" : "white", border: "none", borderRadius: 8, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer" }}>
            {loading ? "Syncing…" : "⟳ Sync from Jira"}
          </button>
        </div>
      </div>

      {/* ── PERIOD PICKER ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "#374151" }}>Period:</span>
        {PERIOD_OPTIONS.slice(0, 13).map(p => (
          <button key={p.key} onClick={() => setPeriodKey(p.key)}
            style={{
              padding: "4px 12px", borderRadius: 16, fontSize: 12, fontWeight: 600, cursor: "pointer",
              border: periodKey === p.key ? "1.5px solid #1e293b" : "1px solid #e2e8f0",
              background: periodKey === p.key ? "#1e293b" : "white",
              color: periodKey === p.key ? "white" : "#64748b",
              transition: "all 0.15s",
            }}>
            {p.label}
          </button>
        ))}
        <select
          value={PERIOD_OPTIONS.findIndex(p => p.key === periodKey) >= 13 ? periodKey : ""}
          onChange={e => e.target.value && setPeriodKey(e.target.value)}
          style={{ border: "1px solid #e2e8f0", borderRadius: 16, padding: "4px 8px", fontSize: 12, color: "#64748b", background: "white", outline: "none", cursor: "pointer" }}>
          <option value="">Quarters…</option>
          {PERIOD_OPTIONS.filter(p => p.key.startsWith("Q")).map(p => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* ── CREDS WARNING ── */}
      {missingCreds && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
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
        <div style={{ background: "#1e293b", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 8, letterSpacing: "0.05em" }}>JQL QUERY</div>
          <div style={{ display: "flex", gap: 10 }}>
            <input value={jql} onChange={e => setJql(e.target.value)} onKeyDown={e => e.key === "Enter" && fetchTickets()}
              style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", color: "#94a3b8", fontSize: 12, fontFamily: "monospace", outline: "none" }} />
            <button onClick={fetchTickets} disabled={loading}
              style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
              Run
            </button>
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* ── EMPTY STATE ── */}
      {!loading && tickets.length === 0 && !error && (
        <div style={{ background: "white", border: "2px dashed #e2e8f0", borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 8 }}>No tickets loaded yet</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Add your Jira credentials as Vercel env vars, then hit "Sync from Jira".</div>
        </div>
      )}

      {tickets.length > 0 && (
        <>
          {/* ── SECTION 1: SUMMARY STATS ── */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(130px,1fr))", gap: 12, marginBottom: 24 }}>
            <SummaryCard label="Total tickets"        value={dateFiltered.length} color="#0f172a" />
            <SummaryCard label="Shipped / done"       value={doneCount}           color="#22c55e" sub={dateFiltered.length ? `${Math.round(doneCount/dateFiltered.length*100)}% complete` : "—"} />
            <SummaryCard label="In progress"          value={activeCount}         color="#3b82f6" />
            <SummaryCard label="Needs investigation"  value={blockedCount}        color="#f59e0b" />
            {newKeys.size > 0 && <SummaryCard label="New this sync" value={newKeys.size} color="#a855f7" sub="Highlighted below" />}
          </div>

          {/* ── SECTION 2: BUCKET CARDS ── */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Quality areas</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>Click a card to see context and filter tickets · Buckets updated each cycle from Signal Scout</div>
              </div>
              {filterBucket && (
                <button onClick={() => setFilterBucket(null)}
                  style={{ fontSize: 12, color: "#3b82f6", background: "none", border: "none", cursor: "pointer", fontWeight: 600 }}>
                  ✕ Clear filter
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12 }}>
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
          <div style={{ background: "#fffbeb", border: "1px solid #fef3c7", borderRadius: 10, padding: "14px 16px", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "#92400e", textTransform: "uppercase" }}>Period summary</span>
              <span style={{ fontSize: 11, color: "#78716c" }}>{period?.label || "All Time"}</span>
            </div>
            {!weeklyInsights ? (
              <p style={{ margin: 0, fontSize: 13, color: "#78716c" }}>Sync from Jira to generate insights.</p>
            ) : (
              <>
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "#1e293b", lineHeight: 1.6 }}>{weeklyInsights.summary}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {weeklyInsights.shipped.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "#92400e", textTransform: "uppercase", marginBottom: 6 }}>Shipped</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {weeklyInsights.shipped.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 6, padding: "3px 8px", textDecoration: "none", fontSize: 11, lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 700, color: "#22c55e", fontFamily: "monospace" }}>{t.key}</span>
                            <span style={{ color: "#374151" }}>{t.summary}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {weeklyInsights.active.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "#92400e", textTransform: "uppercase", marginBottom: 6 }}>In progress</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {weeklyInsights.active.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: 6, padding: "3px 8px", textDecoration: "none", fontSize: 11, lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 700, color: "#3b82f6", fontFamily: "monospace" }}>{t.key}</span>
                            <span style={{ color: "#374151" }}>{t.summary}</span>
                          </a>
                        ))}
                      </div>
                    </div>
                  )}
                  {weeklyInsights.needsDecision.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", color: "#92400e", textTransform: "uppercase", marginBottom: 6 }}>Needs investigation</div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {weeklyInsights.needsDecision.map(t => (
                          <a key={t.key} href={`${JIRA_BASE_URL}/browse/${t.key}`} target="_blank" rel="noopener noreferrer"
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 6, padding: "3px 8px", textDecoration: "none", fontSize: 11, lineHeight: 1.4 }}>
                            <span style={{ fontWeight: 700, color: "#f59e0b", fontFamily: "monospace" }}>{t.key}</span>
                            <span style={{ color: "#374151" }}>{t.summary}</span>
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
          <div style={{ background: "white", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>
                All tickets
                {filterBucket && <span style={{ fontSize: 12, fontWeight: 500, color: "#64748b", marginLeft: 8 }}>— {filterBucket}</span>}
              </div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                  style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 160 }} />
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "5px 8px", fontSize: 12, outline: "none", background: "white" }}>
                  {statuses.map(s => <option key={s}>{s}</option>)}
                </select>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>{filtered.length} of {dateFiltered.length}</span>
              </div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                    {["Ticket","Summary / Epic","Area","Status","Priority","Assignee","Updated"].map(h => (
                      <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0
                    ? <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No tickets match your filters</td></tr>
                    : filtered.map(t => <TicketRow key={t.key} ticket={t} isNew={newKeys.has(t.key)} bucketRules={bucketRules} />)
                  }
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
