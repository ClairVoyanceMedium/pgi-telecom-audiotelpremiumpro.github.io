#!/bin/sh
set -eu

previous="${VERCEL_GIT_PREVIOUS_SHA:-}"
current="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

# If Vercel cannot provide a previous successful SHA, build rather than risk skipping.
[ -n "$previous" ] || exit 1

if git diff --quiet "$previous" "$current" -- \
  Dockerfile.vercel package.json package-lock.json vercel.json \
  index.html client.html sitemap.xml manifest.webmanifest service-worker.js robots.txt \
  llms.txt llms-full.txt fa0a7deb5d60bdf1260c8174ad8c71db.txt .nojekyll \
  site assets backend database scripts/build-static.mjs scripts/direct-sva-seo-plan.mjs scripts/start-vercel.sh
then
  echo "No production-impacting changes; skipping Vercel container build."
  exit 0
fi

exit 1
