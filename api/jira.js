export default async function handler(req, res) {
  const { jql, fields } = req.query;
  const creds = Buffer.from(
    `${process.env.VITE_JIRA_EMAIL}:${process.env.VITE_JIRA_API_TOKEN}`
  ).toString("base64");

  const fieldList = fields ? fields.split(",") : [];
  const PAGE_SIZE = 100;
  let startAt = 0;
  let allIssues = [];

  // Paginate through all results
  while (true) {
    const response = await fetch(
      `${process.env.VITE_JIRA_BASE_URL}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jql,
          maxResults: PAGE_SIZE,
          startAt,
          fields: fieldList,
        }),
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    allIssues = allIssues.concat(data.issues || []);

    // Stop if we've fetched all results
    if (startAt + PAGE_SIZE >= data.total) break;
    startAt += PAGE_SIZE;
  }

  res.status(200).json({ issues: allIssues, total: allIssues.length });
}
