export default async function handler(req, res) {
  const { jql } = req.query;
  const creds = Buffer.from(
    `${process.env.VITE_JIRA_EMAIL}:${process.env.VITE_JIRA_API_TOKEN}`
  ).toString("base64");

  const params = new URLSearchParams({
    jql,
    maxResults: 100,
    fields: "summary,status,priority,assignee,updated,customfield_10005",
  });

  const response = await fetch(
    `${process.env.VITE_JIRA_BASE_URL}/rest/api/3/search?${params}`,
    { headers: { Authorization: `Basic ${creds}`, Accept: "application/json" } }
  );

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json(data);
  res.status(200).json(data);
}
