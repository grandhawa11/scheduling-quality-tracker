import { useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// CONFIG — set these in Vercel environment variables
// VITE_JIRA_BASE_URL   = https://joinhomebase.atlassian.net
// VITE_JIRA_EMAIL      = your-email@joinhomebase.com
// VITE_JIRA_API_TOKEN  = your-jira-api-token
// ---------------------------------------------------------------------------
const JIRA_BASE_URL = import.meta.env.VITE_JIRA_BASE_URL || "https://joinhomebase.atlassian.net";
const JIRA_EMAIL    = import.meta.env.VITE_JIRA_EMAIL    || "";
const JIRA_TOKEN    = import.meta.env.VITE_JIRA_API_TOKEN || "";

const DEFAULT_JQL =
  'project = "SB" AND (labels = "Quality" OR Allocation = "Quality Improvements" OR summary ~ "[Quality]") ORDER BY status ASC, updated DESC';

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
  return (
    <span style={{ color: cfg.color, fontWeight: 700, fontSize: 12, minWidth: 20 }}>
      {cfg.icon}
    </span>
  );
}

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 10,
      padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8" }}>{sub}</div>}
    </div>
  );
}

function TicketRow({ ticket, isNew }) {
  return (
    <tr style={{
      borderBottom: "1px solid #f1f5f9",
      background: isNew ? "#fefce8" : "white",
    }}>
      <td style={{ padding: "10px 12px", width: 100 }}>
        <a
          href={`${JIRA_BASE_URL}/browse/${ticket.key}`}
          target="_blank" rel="noopener noreferrer"
          style={{ color: "#3b82f6", textDecoration: "none", fontSize: 12, fontWeight: 600, fontFamily: "monospace" }}
        >
          {ticket.key}
        </a>
      </td>
      <td style={{ padding: "10px 12px" }}>
        <div style={{ fontSize: 13, color: "#1e293b", lineHeight: 1.4 }}>{ticket.summary}</div>
        {ticket.epic && (
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{ticket.epic}</div>
        )}
      </td>
      <td style={{ padding: "10px 12px", width: 160 }}>
        <StatusBadge status={ticket.status} />
      </td>
      <td style={{ padding: "10px 12px", width: 90 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <PriorityIcon priority={ticket.priority} />
          <span style={{ fontSize: 11, color: "#64748b" }}>{ticket.priority}</span>
        </div>
      </td>
      <td style={{ padding: "10px 12px", width: 110, fontSize: 11, color: "#94a3b8" }}>
        {ticket.assignee || "—"}
      </td>
      <td style={{ padding: "10px 12px", width: 90, fontSize: 11, color: "#94a3b8" }}>
        {ticket.updated
          ? new Date(ticket.updated).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "—"}
      </td>
    </tr>
  );
}

export default function App() {
  const [tickets, setTickets]           = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);
  const [lastFetched, setLastFetched]   = useState(null);
  const [jql, setJql]                   = useState(DEFAULT_JQL);
  const [filterStatus, setFilterStatus] = useState("All");
  const [search, setSearch]             = useState("");
  const [newKeys, setNewKeys]           = useState(new Set());

  const fetchTickets = useCallback(async () => {
    if (!JIRA_EMAIL || !JIRA_TOKEN) {
      setError("Missing Jira credentials. Set VITE_JIRA_EMAIL and VITE_JIRA_API_TOKEN in Vercel environment variables.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const prevKeys = new Set(tickets.map(t => t.key));
      const creds    = btoa(`${JIRA_EMAIL}:${JIRA_TOKEN}`);
      const params   = new URLSearchParams({
        jql,
        maxResults: 100,
        fields: "summary,status,priority,assignee,updated,customfield_10005",
      });
      const res = await fetch(
        `${JIRA_BASE_URL}/rest/api/3/search?${params}`,
        { headers: { Authorization: `Basic ${creds}`, Accept: "application/json" } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.errorMessages?.join(", ") || `Jira returned ${res.status}`);
      }
      const data   = await res.json();
      const parsed = (data.issues || []).map(issue => ({
        key:      issue.key,
        summary:  issue.fields.summary,
        status:   issue.fields.status?.name || "Unknown",
        priority: issue.fields.priority?.name || "None",
        assignee: issue.fields.assignee?.displayName || null,
        epic:     issue.fields.customfield_10005 || null,
        updated:  issue.fields.updated,
      }));
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
  }, [jql, tickets]);

  const statuses = ["All", ...new Set(tickets.map(t => t.status).filter(Boolean))];
  const filtered = tickets.filter(t => {
    const matchStatus = filterStatus === "All" || t.status === filterStatus;
    const matchSearch = !search ||
      t.summary.toLowerCase().includes(search.toLowerCase()) ||
      t.key.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  const doneCount       = tickets.filter(t => t.status === "Done").length;
  const inProgressCount = tickets.filter(t => ["In Progress", "In Review"].includes(t.status)).length;
  const backlogCount    = tickets.filter(t => ["Backlog", "To Do", "Investigation Required"].includes(t.status)).length;
  const missingCreds    = !JIRA_EMAIL || !JIRA_TOKEN;

  return (
    <div style={{ fontFamily: "'IBM Plex Sans','Helvetica Neue',sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
              <div style={{ background: "#1e293b", color: "white", borderRadius: 6, padding: "4px 10px", fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>SCHEDULING</div>
              <div style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>QUALITY TRACKER</div>
            </div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "#0f172a" }}>Quality Work Dashboard</h1>
            {lastFetched && (
              <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>
                Last synced: {lastFetched.toLocaleTimeString()} · {tickets.length} tickets
              </div>
            )}
          </div>
          <button
            onClick={fetchTickets} disabled={loading}
            style={{
              background: loading ? "#e2e8f0" : "#1e293b", color: loading ? "#94a3b8" : "white",
              border: "none", borderRadius: 8, padding: "10px 20px",
              fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Syncing…" : "⟳ Sync from Jira"}
          </button>
        </div>
      </div>

      {/* Creds warning */}
      {missingCreds && (
        <div style={{ background: "#fffbeb", border: "1px solid #fcd34d", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#92400e" }}>
          <strong>Setup required.</strong> Add these in Vercel → Settings → Environment Variables:
          <ul style={{ margin: "8px 0 0", paddingLeft: 20, lineHeight: 1.9 }}>
            <li><code>VITE_JIRA_BASE_URL</code> = <code>https://joinhomebase.atlassian.net</code></li>
            <li><code>VITE_JIRA_EMAIL</code> = your Atlassian login email</li>
            <li><code>VITE_JIRA_API_TOKEN</code> = token from <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noreferrer" style={{ color: "#3b82f6" }}>id.atlassian.com → Security → API tokens</a></li>
          </ul>
        </div>
      )}

      {/* JQL editor */}
      <div style={{ background: "#1e293b", borderRadius: 10, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 600, marginBottom: 8, letterSpacing: "0.05em" }}>JQL QUERY</div>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            value={jql} onChange={e => setJql(e.target.value)}
            onKeyDown={e => e.key === "Enter" && fetchTickets()}
            style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 6, padding: "8px 12px", color: "#94a3b8", fontSize: 12, fontFamily: "monospace", outline: "none" }}
          />
          <button onClick={fetchTickets} disabled={loading}
            style={{ background: "#3b82f6", color: "white", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
            Run
          </button>
        </div>
        <div style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>
          Add <code style={{ color: "#7dd3fc" }}>AND status = Done</code> for shipped only ·{" "}
          <code style={{ color: "#7dd3fc" }}>AND sprint in openSprints()</code> for current sprint
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#dc2626" }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Summary cards */}
      {tickets.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 12, marginBottom: 20 }}>
          <SummaryCard label="Total Tickets"        value={tickets.length}  color="#0f172a" />
          <SummaryCard label="Shipped / Done"       value={doneCount}       color="#22c55e" sub={`${Math.round(doneCount/tickets.length*100)}% complete`} />
          <SummaryCard label="In Progress / Review" value={inProgressCount} color="#3b82f6" />
          <SummaryCard label="Backlog / Investing"  value={backlogCount}    color="#f59e0b" />
          {newKeys.size > 0 && <SummaryCard label="New This Sync" value={newKeys.size} color="#a855f7" sub="Highlighted in yellow" />}
        </div>
      )}

      {/* Empty state */}
      {!loading && tickets.length === 0 && !error && (
        <div style={{ background: "white", border: "2px dashed #e2e8f0", borderRadius: 12, padding: "48px 24px", textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginBottom: 8 }}>No tickets loaded yet</div>
          <div style={{ fontSize: 13, color: "#94a3b8", maxWidth: 420, margin: "0 auto" }}>
            Add your Jira credentials as Vercel env vars, then hit "Sync from Jira".
          </div>
        </div>
      )}

      {/* Table */}
      {tickets.length > 0 && (
        <div style={{ background: "white", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tickets…"
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 12px", fontSize: 13, outline: "none", width: 200 }} />
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
              style={{ border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", fontSize: 13, outline: "none", background: "white" }}>
              {statuses.map(s => <option key={s}>{s}</option>)}
            </select>
            <span style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>{filtered.length} of {tickets.length} tickets</span>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0" }}>
                  {["Ticket","Summary / Epic","Status","Priority","Assignee","Updated"].map(h => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0
                  ? <tr><td colSpan={6} style={{ padding: 32, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>No tickets match your filters</td></tr>
                  : filtered.map(t => <TicketRow key={t.key} ticket={t} isNew={newKeys.has(t.key)} />)
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
