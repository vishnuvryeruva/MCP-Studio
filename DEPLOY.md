# Deploying MCP Studio to Cloud Foundry (BTP)

Two Docker images pushed to Docker Hub and run on Cloud Foundry, the same pattern as
the Yoda web-app:

- **`mcp-studio-api`** — NestJS API (listens on `8080`), reaches the on-prem ABAP
  system through the BTP **Connectivity** service + **SAP Cloud Connector**.
- **`mcp-studio-web`** — Vite/React SPA served by nginx on `8080`.

`deploy.sh` builds both for `linux/amd64`, pushes them, stamps the tags into
`manifest.yml`, and runs `cf push`.

> **Deploy into the `Mygo_BAS` subaccount.** The existing Cloud Connector
> (Location ID **`MYGO-BTP-BAS`**) is attached to that subaccount, so deploying
> there lets MCP Studio reuse the on-prem tunnel with no extra Basis work. Deploying
> elsewhere means the Basis team must add a Cloud Connector connection to that
> subaccount too.

---

## 0. Prerequisites (local, in VS Code terminal)

- Docker Desktop with `buildx` (for `--platform linux/amd64` on Apple Silicon).
- The Cloud Foundry CLI (`cf`), logged into the `Mygo_BAS` subaccount/space:
  ```bash
  cf login -a https://api.cf.us10-001.hana.ondemand.com
  ```
- A Docker Hub account (`docker login`). The images default to the `vishnuvryeruva98`
  namespace — change `DOCKER_USER` in `deploy.sh` if needed.

## 1. One-time BTP setup

### 1a. Bound services (required before the first `cf push`)

All three are bound by `manifest.yml`. Create them once:

```bash
# On-prem tunnel via Cloud Connector
cf create-service connectivity lite mcp-studio-connectivity

# xsuaa — used by the SAP Cloud SDK for token handling
cf create-service xsuaa application mcp-studio-xsuaa -c xs-security.json

# PostgreSQL (the 'free' plan quota may be taken; this project uses 'standard')
cf create-service postgresql-db standard mcp-studio-postgres
```

Postgres provisions asynchronously — wait for `create succeeded` before pushing:

```bash
cf service mcp-studio-postgres    # repeat until status: create succeeded
```

### 1b. Database — no DB_* vars needed on CF

The API reads the bound `postgresql-db` instance straight from `VCAP_SERVICES`
(including TLS) via `src/database/database.config.ts`, and `synchronize: true` creates
the tables on first boot. Nothing to configure. (Locally, with no `VCAP_SERVICES`, it
falls back to the `DB_*` env vars from `.env`.)

### 1c. Environment variables (secrets — not in the manifest)

Only these are needed on CF. **`CREDENTIALS_ENCRYPTION_KEY` is required or the API
crashes on boot.** Set them after the app object exists (see the first-deploy flow):

```bash
cf set-env mcp-studio-api CREDENTIALS_ENCRYPTION_KEY "$(openssl rand -hex 32)"
cf set-env mcp-studio-api JWT_SECRET "$(openssl rand -hex 32)"
cf set-env mcp-studio-api CORS_ORIGIN "https://mcp-studio-web.cfapps.us10-001.hana.ondemand.com"
cf set-env mcp-studio-api SAP_CLOUD_CONNECTOR_LOCATION_ID "MYGO-BTP-BAS"
```

`SAP_CLOUD_CONNECTOR_LOCATION_ID` is the app-wide default; a destination can still
override it with its own `cloudConnectorLocationId`.

## 2. Deploy

**First deploy** (env vars can only be set once the app exists, so start it *after*):

```bash
./deploy.sh --no-start                       # build+push images, create apps, bind services, don't start
# ...run the cf set-env commands from 1c...
cf start mcp-studio-api mcp-studio-web
```

**Every deploy after that:**

```bash
./deploy.sh                                  # rebuild, push fresh tags, cf push (starts)
```

---

## 3. What the Basis / SAP team owns (on-prem side)

The Cloud Connector already exists — these are the remaining SAP-side items:

1. **`fmcall` ICF handler** active on the target ABAP system (the HTTP endpoint that
   does the dynamic `CALL FUNCTION` and returns JSON).
2. **Cloud Connector resource whitelist:** in the connector admin UI, under the target
   virtual host (e.g. `192.168.171.41:8000` "HMP S/4HANA 1909"), add the fmcall URL
   path to **Resources**. If it isn't listed, the connector returns **403** even though
   the host shows "Available".
3. **Technical/communication user** for MCP Studio, with **`S_RFC`** restricted to only
   the function modules you intend to expose.

## 4. Configure a destination in the app

Create a SAP Destination via the admin UI / API with:

| Field                      | Value                                                        |
|----------------------------|-------------------------------------------------------------|
| `url`                      | the Cloud Connector **virtual host**, e.g. `http://192.168.171.41:8000` (not a public URL) |
| `sapUser` / `sapPassword`  | the technical user from step 3                              |
| `cloudConnectorLocationId` | `MYGO-BTP-BAS` (optional — falls back to the env default)   |

Then **Test Connection**. Expected results:
- **2xx** → reachable and credentials accepted.
- **401/403** → reached SAP but the technical user was rejected (or the fmcall path
  isn't whitelisted in the Cloud Connector).
- **Could not reach** → connectivity binding missing, wrong subaccount, or the virtual
  host/Location ID is wrong.

## 5. Whitelisting recap (three layers, all kept)

1. **Cloud Connector Resources** — which URL paths the tunnel exposes (step 3.2).
2. **`S_RFC`** — which FMs the technical user may execute (step 3.3).
3. **MCP Studio `FunctionModule` allowlist** — which of those Claude may call as tools.

## 6. Notes

- **Route conflicts:** hosts on the shared `cfapps.us10-001.hana.ondemand.com` domain
  are global. If `cf push` reports a route is taken, change the hosts in `manifest.yml`
  and the matching URLs in `deploy.sh`.
- **`VITE_API_URL` is baked at build time.** If the API route changes, rebuild the web
  image (`deploy.sh` passes it as a `--build-arg`) — `cf set-env` alone won't update the
  browser bundle.
