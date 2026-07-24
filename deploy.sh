#!/bin/bash
set -e

# ─── Config ───────────────────────────────────────────────────────────────────
DOCKER_USER="vishnuvryeruva98"
CF_API="https://api.cf.us10-001.hana.ondemand.com"
MANIFEST_FILE="manifest.yml"

# Public URL of the API app — baked into the web bundle at build time (VITE_API_URL)
# and used as the CORS origin. Must match the api route in manifest.yml.
API_URL="https://mcp-studio-api.cfapps.us10-001.hana.ondemand.com"
WEB_URL="https://mcp-studio-web.cfapps.us10-001.hana.ondemand.com"

TAG="v$(date +%Y%m%d%H%M)"
API_IMAGE="$DOCKER_USER/mcp-studio-api:$TAG"
WEB_IMAGE="$DOCKER_USER/mcp-studio-web:$TAG"

# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║                        ⚠️  ENV VARS REMINDER  ⚠️                            ║
# ╠══════════════════════════════════════════════════════════════════════════════╣
# ║  Env vars are NOT in the manifest. Set them once with cf set-env, then         ║
# ║  cf restage. See DEPLOY.md for the full list. Minimum for mcp-studio-api:      ║
# ║                                                                                ║
# ║    cf set-env mcp-studio-api DB_HOST "..."                                     ║
# ║    cf set-env mcp-studio-api DB_PORT "5432"                                    ║
# ║    cf set-env mcp-studio-api DB_USERNAME "..."                                 ║
# ║    cf set-env mcp-studio-api DB_PASSWORD "..."                                 ║
# ║    cf set-env mcp-studio-api DB_DATABASE "..."                                 ║
# ║    cf set-env mcp-studio-api JWT_SECRET "..."                                  ║
# ║    cf set-env mcp-studio-api CREDENTIALS_ENCRYPTION_KEY "<64 hex chars>"       ║
# ║    cf set-env mcp-studio-api CORS_ORIGIN "$WEB_URL"                            ║
# ║    cf set-env mcp-studio-api SAP_CLOUD_CONNECTOR_LOCATION_ID "MYGO-BTP-BAS"    ║
# ║                                                                                ║
# ║    After setting env vars:  cf restage mcp-studio-api                          ║
# ╚══════════════════════════════════════════════════════════════════════════════╝

# ─── Sanity check ─────────────────────────────────────────────────────────────
if [ ! -f "$MANIFEST_FILE" ]; then
  echo "❌ $MANIFEST_FILE not found in $(pwd)"
  exit 1
fi

# ─── Auth ─────────────────────────────────────────────────────────────────────
echo "🔐 Logging into Docker Hub..."
docker login

echo "🔐 Logging into Cloud Foundry..."
cf login -a "$CF_API"

# ─── Build (linux/amd64 for BTP) ──────────────────────────────────────────────
echo "📦 Building API image ($API_IMAGE) for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  -t "$API_IMAGE" \
  --push \
  ./api

echo "📦 Building web image ($WEB_IMAGE) for linux/amd64..."
docker buildx build \
  --platform linux/amd64 \
  --build-arg VITE_API_URL="$API_URL" \
  -t "$WEB_IMAGE" \
  --push \
  ./web

# ─── Update manifest with the new tags ────────────────────────────────────────
echo "📝 Updating $MANIFEST_FILE..."
cp "$MANIFEST_FILE" "${MANIFEST_FILE}.bak"
sed -i '' \
  -e "s|$DOCKER_USER/mcp-studio-api:.*|$DOCKER_USER/mcp-studio-api:$TAG|" \
  -e "s|$DOCKER_USER/mcp-studio-web:.*|$DOCKER_USER/mcp-studio-web:$TAG|" \
  "$MANIFEST_FILE"

# ─── Deploy ───────────────────────────────────────────────────────────────────
# Extra args pass through to `cf push`. FIRST deploy: run `./deploy.sh --no-start`,
# then set env vars (see DEPLOY.md), then `cf start mcp-studio-api mcp-studio-web`.
echo "☁️  Deploying to Cloud Foundry..."
cf push "$@"

# ─── Done ─────────────────────────────────────────────────────────────────────
echo ""
echo "✅ Deployment complete!"
echo "   Tag : $TAG"
echo "   API : $API_URL"
echo "   Web : $WEB_URL"
echo ""
echo "⚠️  First deploy only: create the bound services and set env vars (see DEPLOY.md),"
echo "   then run: cf restage mcp-studio-api"
