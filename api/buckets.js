const DEFAULT_SHEET_ID = "1nVVNwpjClt_kXHnSa99xje9esTqjMq8zeHdGauQdjuc";

export default async function handler(req, res) {
  const sheetId = req.query.sheet || DEFAULT_SHEET_ID;
  const CSV_URL =
    `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

  const response = await fetch(CSV_URL);
  if (!response.ok) return res.status(500).json({ error: "Failed to fetch bucket config" });

  const text = await response.text();

  // Parse CSV — skip header row, split rows and columns
  const rows = text.trim().split("\n").slice(1);
  const buckets = rows
    .map(row => {
      // Handle quoted CSV fields
      const cols = row.match(/(".*?"|[^",\n]+)(?=\s*,|\s*$)/g) || [];
      const clean = cols.map(c => c.replace(/^"|"$/g, "").trim());
      return {
        label:             clean[0] || "",
        color:             clean[1] || "#6b7280",
        keywords:          (clean[2] || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean),
        problem:           clean[3] || "",
        what_we_are_doing: clean[4] || "",
        why_now:           clean[5] || "",
      };
    })
    .filter(b => b.label);

  res.setHeader("Cache-Control", "s-maxage=3600"); // cache for 1 hour on Vercel edge
  res.status(200).json(buckets);
}
