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

The manifest binds `mcp-studio-connectivity`, `mcp-studio-xsuaa`, and the existing
`PostgreSQL-instance`. Create the first two once (the database is reused, not created):

```bash
# On-prem tunnel via Cloud Connector
cf create-service connectivity lite mcp-studio-connectivity

# xsuaa — used by the SAP Cloud SDK for token handling
cf create-service xsuaa application mcp-studio-xsuaa -c xs-security.json
```

### 1b. Database — reused instance, isolated schema, no DB_* vars on CF

New `postgresql-db` instances are entitlement-blocked in this subaccount, so MCP Studio
**reuses the existing `PostgreSQL-instance`** (shared with Yoda). To stay isolated, all
of MCP Studio's tables live in a dedicated Postgres schema set by `DB_SCHEMA=mcp_studio`
(in `manifest.yml`); the app creates that schema on boot and `synchronize` builds the
tables there, never touching Yoda's. Credentials + TLS come from `VCAP_SERVICES` via
`src/database/database.config.ts` — nothing else to configure. (Locally, with no
`VCAP_SERVICES`, it falls back to the `DB_*` env vars from `.env`.)

### 1c. Environment variables (secrets — not in the manifest)

Only these are needed on CF. **`CREDENTIALS_ENCRYPTION_KEY` is required or the API
crashes on boot.** Set them after the app object exists (see the first-deploy flow):

```bash
cf set-env mcp-studio-api CREDENTIALS_ENCRYPTION_KEY "$(openssl rand -hex 32)"
cf set-env mcp-studio-api JWT_SECRET "$(openssl rand -hex 32)"
# CORS_ORIGIN must EXACTLY match the URL you open in the browser (scheme, host, no
# trailing slash). It accepts a comma-separated list to allow more than one route
# (e.g. the canonical + trial CF routes):
cf set-env mcp-studio-api CORS_ORIGIN "https://mcp-studio-web.cfapps.us10-001.hana.ondemand.com,https://mcp-studio-web-97415b8ftrial.cfapps.us10-001.hana.ondemand.com"
cf set-env mcp-studio-api SAP_CLOUD_CONNECTOR_LOCATION_ID "MYGO-BTP-BAS"
```

`SAP_CLOUD_CONNECTOR_LOCATION_ID` is the app-wide default; a destination can still
override it with its own `cloudConnectorLocationId`.

### 1d. Tool selection (optional)

Every whitelisted function module is sent to the model on every chat turn, so a large
whitelist costs tokens and gives the model more near-identical options to choose between.
Setting an embedding key turns on two things: a per-question shortlist of the tools worth
advertising, and a warning when a newly saved module reads almost the same as an existing
one.

**Anthropic has no embeddings API**, so this needs an OpenAI or Gemini key even when
`LLM_PROVIDER=anthropic`. Without one, both features stay off and chat behaves exactly as
before — all tools advertised, no overlap warnings.

```bash
cf set-env mcp-studio-api OPENAI_API_KEY "sk-..."
cf set-env mcp-studio-api EMBEDDING_PROVIDER "openai"   # or "gemini"
```

Vectors are computed on demand and cached in `function_module_embeddings`, keyed by a hash
of the tool's name, description, and parameters — editing a module re-embeds it on next
use, and changing `EMBEDDING_PROVIDER` or the embedding model re-embeds everything.

Defaults are deliberately conservative (advertising too few tools makes an answerable
question unanswerable). Tune only if needed:

| Variable | Default | Effect |
| --- | --- | --- |
| `LLM_TOOL_SELECTION` | `true` | Set `false` to always advertise everything. |
| `LLM_TOOL_SELECTION_SEND_ALL_BELOW` | `8` | Whitelists this size or smaller skip embedding entirely. |
| `LLM_TOOL_SELECTION_TOP_K` | `10` | Max tools advertised per turn. |
| `LLM_TOOL_SELECTION_MIN_SCORE` | `0.2` | Cosine floor to count as relevant. |
| `LLM_TOOL_SELECTION_MIN_TOOLS` | `3` | Advertised even when nothing clears the floor. |
| `LLM_OVERLAP_WARN_SCORE` | `0.9` | Similarity at which two modules are flagged as confusable. |

A shortlist only limits what the model is *told about*, not what it may call: if it names a
whitelisted tool that wasn't advertised, the call still runs. If answers start coming back
as "no tool can answer that", check the API log — narrowed turns log the ratio advertised.

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

Each destination chooses how it reaches SAP. Both transports are supported at the same
time, so one org can have some destinations on each.

### 4a. `direct_fmcall` (default)

MCP Studio calls the ABAP fmcall service itself, tunnelling through the BTP
Connectivity service and Cloud Connector with a backend SAP user. This app owns the
proxy authentication and redirect handling.

| Field                      | Value                                                        |
|----------------------------|-------------------------------------------------------------|
| `url`                      | the Cloud Connector **virtual host**, e.g. `http://192.168.171.41:8000` (not a public URL) |
| `sapUser` / `sapPassword`  | the technical user from step 3                              |
| `cloudConnectorLocationId` | `MYGO-BTP-BAS` (optional — falls back to the env default)   |

Whitelisted function modules need an **fmcall URL / path** on this transport.

Then **Test Connection**. Expected results:
- **2xx** → reachable and credentials accepted.
- **401/403** → reached SAP but the technical user was rejected (or the fmcall path
  isn't whitelisted in the Cloud Connector).
- **407** → the connectivity proxy rejected the call; the request never reached SAP.
- **Could not reach** → connectivity binding missing, wrong subaccount, or the virtual
  host/Location ID is wrong.

### 4b. `cap_facade`

MCP Studio posts `{ functionModule, parameters }` to a deployed CAP service that
performs the fmcall on our behalf. The Cloud Connector hop and the SAP user belong to
that service, so none of the proxy or redirect handling above applies here — but the
CAP app has to be deployed and bound separately.

| Field             | Value                                                                    |
|-------------------|--------------------------------------------------------------------------|
| `url`             | the CAP app's public route, e.g. `https://…​.cfapps.us10-001.hana.ondemand.com` |
| `capExecutePath`  | the execute action (defaults to `/integration/execute`)                  |
| `capTokenUrl`     | the XSUAA `url` from the CAP app's service key + `/oauth/token`          |
| `capClientId`     | `clientid` from that service key (not a secret)                          |
| `capClientSecret` | `clientsecret` from that service key (encrypted at rest, never returned) |

Function modules behind this transport need **no fmcall URL** — the CAP service looks
them up by `fmName`. Service discovery is also unavailable, since it reads the SAP
Gateway catalog directly; add these modules manually.

**Test Connection** here fetches an XSUAA token and then reads the service's
`$metadata`; it does not execute a function module. A failure names which half broke —
the token request or the CAP service.

Switching an existing destination between transports clears the credentials the old one
used, so you must supply the new transport's credentials with that change.

## 5. Whitelisting recap (three layers, all kept)

1. **Cloud Connector Resources** — which URL paths the tunnel exposes (step 3.2).
2. **`S_RFC`** — which FMs the technical user may execute (step 3.3).
3. **MCP Studio `FunctionModule` allowlist** — which of those Claude may call as tools.

On `cap_facade` destinations the first two layers belong to the CAP app's own binding
and its fmcall class, so the CAP service is what limits which function modules can run
at all; layer 3 is unchanged.

## 6. Notes

- **Route conflicts:** hosts on the shared `cfapps.us10-001.hana.ondemand.com` domain
  are global. If `cf push` reports a route is taken, change the hosts in `manifest.yml`
  and the matching URLs in `deploy.sh`.
- **`VITE_API_URL` is baked at build time.** If the API route changes, rebuild the web
  image (`deploy.sh` passes it as a `--build-arg`) — `cf set-env` alone won't update the
  browser bundle.
