const required = ["VERCEL_TOKEN","VERCEL_PROJECT_ID","VERCEL_TEAM_ID","VCR_REPOSITORY"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`${key} is required`);
}

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const teamId = process.env.VERCEL_TEAM_ID;
const repository = process.env.VCR_REPOSITORY;
const keep = Math.max(3, Number.parseInt(process.env.VCR_KEEP || "10", 10));

const headers = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json"
};

const params = new URLSearchParams({
  projectId,
  teamId,
  limit: "100"
});

const listUrl =
  `https://api.vercel.com/v1/vcr/repository/${encodeURIComponent(repository)}/images?${params}`;

const response = await fetch(listUrl, {headers});
if (response.status === 404) {
  console.log(`VCR repository "${repository}" does not exist yet; nothing to prune.`);
  process.exit(0);
}
if (!response.ok) {
  throw new Error(`Unable to list VCR images: ${response.status} ${await response.text()}`);
}

const payload = await response.json();
const images = Array.isArray(payload.images) ? payload.images : [];
const ordered = images
  .filter(image => image && image.id)
  .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

const protectedIds = new Set(
  ordered
    .filter((image, index) => index < keep || image.status !== "ready")
    .map(image => image.id)
);

const stale = ordered.filter(image => !protectedIds.has(image.id));

console.log(
  `Repository ${repository}: ${ordered.length} image(s), keeping ${protectedIds.size}, pruning ${stale.length}.`
);

for (const image of stale) {
  const deleteParams = new URLSearchParams({projectId, teamId});
  const deleteUrl =
    `https://api.vercel.com/v1/vcr/repository/${encodeURIComponent(repository)}/images/${encodeURIComponent(image.id)}?${deleteParams}`;
  const deleted = await fetch(deleteUrl, {method: "DELETE", headers});
  if (!deleted.ok && deleted.status !== 202 && deleted.status !== 204) {
    throw new Error(
      `Unable to delete VCR image ${image.id}: ${deleted.status} ${await deleted.text()}`
    );
  }
  const tags = Array.isArray(image.tags) ? image.tags.join(",") : "";
  console.log(`Scheduled deletion: ${image.id}${tags ? ` [${tags}]` : ""}`);
}
