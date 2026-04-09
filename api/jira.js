export default async function handler(req, res) {
  const { jql, fields } = req.query;
  const creds = Buffer.from(
    `${process.env.VITE_JIRA_EMAIL}:${process.env.VITE_JIRA_API_TOKEN}`
  ).toString("base64");

  const fieldList = fields ? fields.split(",") : [];
  const PAGE_SIZE = 100;
  let allIssues = [];
  let nextPageToken = undefined;

  // Paginate through all results using cursor-based pagination
  while (true) {
    const body = { jql, maxResults: PAGE_SIZE, fields: fieldList };
    if (nextPageToken) body.nextPageToken = nextPageToken;

    const response = await fetch(
      `${process.env.VITE_JIRA_BASE_URL}/rest/api/3/search/jql`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${creds}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);

    allIssues = allIssues.concat(data.issues || []);

    // Stop if no more pages
    if (!data.nextPageToken) break;
    nextPageToken = data.nextPageToken;
  }

  res.status(200).json({ issues: allIssues, total: allIssues.length });
}
