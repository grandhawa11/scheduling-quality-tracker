export default async function handler(req, res) {
  const { jql, maxResults, fields } = req.query;
  const creds = Buffer.from(
    `${process.env.VITE_JIRA_EMAIL}:${process.env.VITE_JIRA_API_TOKEN}`
  ).toString("base64");

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
        maxResults: Number(maxResults) || 100,
        fields: fields ? fields.split(",") : [],
      }),
    }
  );

  const data = await response.json();
  if (!response.ok) return res.status(response.status).json(data);
  res.status(200).json(data);
}
