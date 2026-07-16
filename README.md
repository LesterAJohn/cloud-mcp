# cloud-mcp

A Node.js skeleton for wrapping multiple cloud CLIs behind one command surface.

## What this gives you

- Unified CLI entrypoint (`cloud-wrap`)
- Provider pass-through commands for AWS, GCP, Azure, OCI, Alibaba, DigitalOcean, IBM Cloud, Tencent Cloud, and Huawei Cloud
- Config file support to override command paths and inject environment variables
- Vault abstraction for storing provider attributes with optional external replacement
- MCP stdio server that registers provider tools and command runners
- Structured logging and safe command execution with inherited stdio

## Quick start

```bash
npm install
npm run bootstrap:clis
npm start -- list
npm start -- aws sts get-caller-identity
npm start -- oci iam region list
npm start -- alibaba ecs DescribeInstances
npm run mcp
```

## Repository-local CLI layout

This project can keep provider CLI entrypoints under `mcp/<provider>/bin`.

- `mcp/aws/bin/aws`
- `mcp/gcp/bin/gcloud`
- `mcp/azure/bin/az`
- `mcp/oci/bin/oci`
- `mcp/alibaba/bin/aliyun`
- `mcp/digitalocean/bin/doctl`
- `mcp/ibmcloud/bin/ibmcloud`
- `mcp/tencent/bin/tccli`
- `mcp/huawei/bin/hcloud`

Run the bootstrap command to create links from your installed CLIs into this structure:

```bash
npm run bootstrap:clis
```

Or pull and install all CLIs directly into the structure:

```bash
npm run install:clis
```

This installer covers AWS, GCP, Azure, OCI, Alibaba, DigitalOcean, IBM Cloud, and Tencent Cloud directly. Huawei Cloud is wired through the same provider interface, but the public `huaweicloudcli` Python package referenced by older installer versions is not available; set `HUAWEI_CLI_BIN` to a supported `hcloud`-compatible binary to enable Huawei command execution.

At runtime, provider resolution order is:

1. `mcp/<provider>/bin/<cli>` when present
2. `<PROVIDER>_CLI_BIN` environment override
3. CLI from `PATH`

If neither `HUAWEI_CLI_BIN` nor `hcloud` on `PATH` is available during `npm run install:clis`, a placeholder `mcp/huawei/bin/hcloud` is created that fails with an explicit setup message instead of breaking the image build.

Shared command limits live in [mcp/cloud-command-limits.json](/Users/lesterjohn/Documents/GitHub/cloud-mcp/mcp/cloud-command-limits.json).

Current repository default (`mcp/cloud-command-limits.json`) is permissive for all providers and intentionally includes CLI-style aliases for two sections:

```json
{
  "alibaba.*": [],
  "aws.*": [],
  "az.*": [],
  "digitalocean.*": [],
  "gcloud.*": [],
  "huawei.*": [],
  "ibmcloud.*": [],
  "oci.*": [],
  "tencent.*": []
}
```

At load time this is normalized to canonical provider sections, so `az.*` becomes `azure.*` and `gcloud.*` becomes `gcp.*` in the effective runtime policy.

External command-limit loading:

- `CLOUD_COMMAND_LIMITS_SOURCE` (optional): load command limits from an external source at startup.
  - Supported values: file path, `file://` URL, `http://` URL, `https://` URL.
- `CLOUD_COMMAND_LIMITS_REFRESH_INTERVAL_SECONDS` (optional): when `CLOUD_COMMAND_LIMITS_SOURCE` is set and this value is `> 0`, command limits are reloaded on that interval.
- If refresh fails, the last successfully loaded limits remain active.

PostgreSQL-backed command limits:

- Command limits are persisted in PostgreSQL table `cloud_mcp.command_limits`.
- Runtime command validation reads limits from the database before each provider command execution.
- On startup, limits are loaded from `mcp/cloud-command-limits.json` (or `CLOUD_COMMAND_LIMITS_SOURCE`) and synced into PostgreSQL.
- When refresh is enabled, each refresh cycle updates PostgreSQL records from the external source.

Database environment variables:

- `COMMAND_LIMITS_DATABASE_URL` (preferred), or
- `DATABASE_URL`
- `COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED` (optional): when `true|1|yes` and no external DB URL is set, auto-uses local postgres URL.
- `COMMAND_LIMITS_LOCAL_POSTGRES_PORT` (required when local postgres auto-mode is enabled): local postgres port used to build the DB URL.

If neither database variable is set, command limits run in in-memory mode.

Database resolution order:

1. Use `COMMAND_LIMITS_DATABASE_URL` when set.
2. Else use `DATABASE_URL` when set.
3. Else if `COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED=true|1|yes`, require `COMMAND_LIMITS_LOCAL_POSTGRES_PORT` and use `postgres://cloud_mcp:cloud_mcp@127.0.0.1:<port>/cloud_mcp`.
4. Else run in-memory mode.

Start local PostgreSQL from repository assets:

```bash
export COMMAND_LIMITS_LOCAL_POSTGRES_PORT=5432
docker compose -f docker-compose.postgres.yml up -d
export COMMAND_LIMITS_DATABASE_URL="postgres://cloud_mcp:cloud_mcp@127.0.0.1:5432/cloud_mcp"
```

Standalone migration for existing databases:

```bash
psql "$COMMAND_LIMITS_DATABASE_URL" -f db/migrations/002_command_limits_namespace_migration.sql
```

This migration creates `cloud_mcp.command_limits`, copies legacy rows from `public.command_limits` when present, and ensures default provider-prefix records exist.

- Enforced sections are keyed by provider prefix: `aws.*`, `gcp.*`, `azure.*`, `oci.*`, `alibaba.*`, `digitalocean.*`, `ibmcloud.*`, `tencent.*`, `huawei.*`
- If a section is an empty array, all commands for that provider are allowed
- If a section contains entries, only matching prefixes are allowed
- Entries may be written as full prefixes like `aws.s3` or shorthand like `s3` within the `aws.*` section

Prefix naming note:

- Runtime enforcement uses provider names (`aws`, `gcp`, `azure`, `oci`, `alibaba`, `digitalocean`, `ibmcloud`, `tencent`, `huawei`), not binary names.
- CLI-style aliases are supported and normalized during load:
  - `gcloud.*` maps to `gcp.*`
  - `az.*` maps to `azure.*`
  - `aliyun.*` maps to `alibaba.*`
  - `doctl.*` maps to `digitalocean.*`
  - `tccli.*` maps to `tencent.*`
  - `hcloud.*` maps to `huawei.*`
- If both canonical and alias keys are provided for the same provider, canonical keys win (`gcp.*` over `gcloud.*`, `azure.*` over `az.*`, `alibaba.*` over `aliyun.*`, `digitalocean.*` over `doctl.*`, `tencent.*` over `tccli.*`, `huawei.*` over `hcloud.*`).
- Recommended mapping is:
  - `aws.*` for `aws`
  - `gcp.*` for `gcloud`
  - `azure.*` for `az`
  - `oci.*` for `oci`
  - `alibaba.*` for `aliyun`
  - `digitalocean.*` for `doctl`
  - `ibmcloud.*` for `ibmcloud`
  - `tencent.*` for `tccli`
  - `huawei.*` for `hcloud`

How to fill out the file:

1. Allow everything for every cloud:

```json
{
  "alibaba.*": [],
  "aws.*": [],
  "digitalocean.*": [],
  "gcp.*": [],
  "azure.*": [],
  "oci.*": [],
  "ibmcloud.*": [],
  "tencent.*": [],
  "huawei.*": []
}
```

2. Restrict AWS and GCP, leave Azure and OCI open:

```json
{
  "alibaba.*": ["ecs"],
  "aws.*": ["s3", "sts.get-caller-identity"],
  "gcp.*": ["projects", "compute.instances.list"],
  "azure.*": [],
  "oci.*": [],
  "digitalocean.*": ["compute"],
  "ibmcloud.*": [],
  "tencent.*": ["cvm"],
  "huawei.*": ["ecs"]
}
```

3. Use full provider-prefixed entries explicitly:

```json
{
  "aws.*": ["aws.s3", "aws.sts.get-caller-identity"],
  "gcp.*": ["projects", "compute.instances.list"],
  "azure.*": [],
  "oci.*": ["oci.iam"]
}
```

4. Lock each provider to a narrow subset:

```json
{
  "aws.*": ["ec2.describe-instances", "s3.ls"],
  "gcp.*": ["projects.list"],
  "azure.*": ["vm", "account.show"],
  "oci.*": ["iam.region.list"]
}
```

What the entries mean:

- `"s3"` inside `aws.*` means any AWS command starting with `aws.s3...`
- `"sts.get-caller-identity"` inside `aws.*` means only `aws sts get-caller-identity`
- `"projects"` inside `gcp.*` means any GCP command starting with `gcp.projects...`
- `"oci.iam"` inside `oci.*` means any OCI command starting with `oci.iam...`

With this file:

- `aws s3 ls` is allowed
- `aws ec2 describe-instances` is denied
- all Azure commands are allowed
- `gcloud projects list` is allowed
- `oci iam region list` is allowed

## Usage

### Generic form

```bash
npm start -- run <provider> [args...]
```

Examples:

```bash
npm start -- run aws s3 ls
npm start -- run gcp projects list
npm start -- run azure account show
npm start -- run oci iam region list
npm start -- run digitalocean compute droplet list
```

### Provider shorthands

```bash
npm start -- aws s3 ls
npm start -- gcp projects list
npm start -- azure account show
npm start -- oci iam region list
npm start -- tencent cvm DescribeInstances
```

## MCP server

Start MCP with both stdio and HTTP transports (default):

```bash
npm run mcp -- --config cloud-wrap.config.json
```

Run HTTP-only or stdio-only:

```bash
npm run mcp:http -- --config cloud-wrap.config.json
npm run mcp -- --transport stdio --config cloud-wrap.config.json
```

HTTP defaults:

- `MCP_HTTP_HOST=127.0.0.1`
- `MCP_HTTP_PORT=3000`
- `MCP_HTTP_PATH=/mcp`
- `MCP_HTTP_HEALTH_PATH=/healthz`

Transport mode:

- `MCP_TRANSPORT_MODE=stdio|http|both` (default: `both`)

HTTP authentication framework:

- `MCP_HTTP_AUTH_MODE=none|token|oauth2|both` (default: `none`)
- Bearer token mode (`token` or `both`):
  - `MCP_HTTP_TOKEN_SOURCE=env|vault` (default: `env`)
  - `MCP_HTTP_AUTH_TOKENS` (comma-separated bearer tokens)
  - Vault source settings (when `MCP_HTTP_TOKEN_SOURCE=vault`):
    - `MCP_HTTP_VAULT_TOKEN_INDEX_PATH` (default: `cloud-mcp/http/auth/token-index`)
    - `MCP_HTTP_VAULT_TOKEN_DEFAULT_USER_ID` (default: `default`)
    - `MCP_HTTP_VAULT_TOKEN_REQUIRED_SCOPES` (comma-separated, optional)
    - `MCP_HTTP_VAULT_TOKEN_REQUIRED_AUDIENCE` (comma-separated, optional)
    - `MCP_HTTP_VAULT_TOKEN_CACHE_TTL_MS` (optional)
- OAuth2 introspection mode (`oauth2` or `both`):
  - `MCP_HTTP_OAUTH2_INTROSPECTION_URL`
  - `MCP_HTTP_OAUTH2_CLIENT_ID` (optional)
  - `MCP_HTTP_OAUTH2_CLIENT_SECRET` (optional)
  - `MCP_HTTP_OAUTH2_REQUIRED_SCOPES` (comma-separated, optional)
  - `MCP_HTTP_OAUTH2_REQUIRED_AUDIENCE` (comma-separated, optional)
  - `MCP_HTTP_OAUTH2_TIMEOUT_MS` (optional)
  - `MCP_HTTP_OAUTH2_CACHE_TTL_MS` (optional)

Example: bearer tokens only

```bash
export MCP_HTTP_AUTH_MODE=token
export MCP_HTTP_AUTH_TOKENS="dev-token-1,dev-token-2"
npm run mcp -- --config cloud-wrap.config.json
```

Example: Vault-backed bearer token index

```bash
export MCP_HTTP_AUTH_MODE=token
export MCP_HTTP_TOKEN_SOURCE=vault
export MCP_HTTP_VAULT_TOKEN_INDEX_PATH="cloud-mcp/http/auth/token-index"
npm run mcp -- --config cloud-wrap.config.json
```

Vault token index shape (tokens stored by SHA-256 hash, not plaintext):

```json
{
  "tokens": {
    "<sha256(token)>": {
      "userId": "default",
      "tokenId": "tok-123",
      "active": true,
      "scopes": ["mcp:invoke"],
      "audience": ["cloud-mcp"],
      "expiresAt": "2026-12-31T23:59:59Z"
    }
  }
}
```

Example: OAuth2 introspection only

```bash
export MCP_HTTP_AUTH_MODE=oauth2
export MCP_HTTP_OAUTH2_INTROSPECTION_URL="https://auth.example.com/oauth2/introspect"
export MCP_HTTP_OAUTH2_CLIENT_ID="cloud-mcp"
export MCP_HTTP_OAUTH2_CLIENT_SECRET="replace-me"
export MCP_HTTP_OAUTH2_REQUIRED_SCOPES="mcp:invoke"
npm run mcp -- --config cloud-wrap.config.json
```

It registers these tools:

- `list_providers`
- `get_provider`
- `set_provider`
- `run_provider`
- `run_aws`
- `run_gcp`
- `run_azure`
- `run_oci`
- `run_alibaba`
- `run_digitalocean`
- `run_ibmcloud`
- `run_tencent`
- `run_huawei`
- `get_command_limits`
- `set_command_limit_section`
- `replace_command_limits`
- `push_command_limits`
- `vault_seed_http_token`
- `vault_seed_oauth_token`

Command-limit MCP management:

- `get_command_limits`: reads effective command limits from database.
- `set_command_limit_section`: updates one provider section in database, then force-pushes to JSON target.
- `replace_command_limits`: replaces all sections in database, then force-pushes to JSON target.
- `push_command_limits`: force-pushes current DB limits to JSON target without modifying DB.

Force-push target:

- `pushTarget=internal`: writes to local `mcp/cloud-command-limits.json` (or configured internal path).
- `pushTarget=external`: writes to `CLOUD_COMMAND_LIMITS_SOURCE`.
- `pushTarget=auto`: uses external source when configured, otherwise internal file.

Provider vault authorization:

- Set `MCP_PROVIDER_AUTH_KEY` to store an authorization key in vault at startup.
- When configured, `get_provider` and `set_provider` require `authorizationKey` in the request input.
- When configured, `set_command_limit_section`, `replace_command_limits`, and `push_command_limits` also require `authorizationKey`.
- When configured, `vault_seed_http_token` and `vault_seed_oauth_token` also require `authorizationKey`.
- Requests with missing or invalid keys are rejected.

HTTP token index management tools:

- `vault_seed_http_token`: generates a random bearer token, stores only its SHA-256 hash in the Vault token index, and returns the generated token once.
- `vault_seed_oauth_token`: stores a provided OAuth access token hash in the Vault token index (does not return plaintext token).

Both tools support optional:

- `userId`
- `tokenId`
- `scopes` (string or array)
- `audience` (string or array)
- `expiresAt`
- `path` (override token index path)

Example `vault_seed_http_token` response fields include `token`, `tokenHash`, `tokenId`, and `indexPath`.
Example `vault_seed_oauth_token` response fields include `tokenHash`, `tokenId`, and `indexPath`.

## Container note

This repository no longer ships a first-party `Dockerfile`, so it does not provide a built-in container image build path.

If your deployment requires containers, provide your own image definition around the Node entrypoints (`node src/mcp.js` for MCP mode, `node src/index.js` for CLI mode) and any cloud CLIs you want available in that runtime.

A sample container definition is available at `docker/Containerfile.sample` and can be used with either Docker or Podman:

```bash
docker build -f docker/Containerfile.sample -t cloud-mcp:local .
podman build -f docker/Containerfile.sample -t cloud-mcp:local .
```

## Kubernetes (Helm) sample

A sample Helm chart is available at `helm/cloud-mcp`.

1. Build and push an image (Docker or Podman):

```bash
docker build -f docker/Containerfile.sample -t ghcr.io/your-org/cloud-mcp:latest .
docker push ghcr.io/your-org/cloud-mcp:latest
```

2. Copy chart values and edit for your environment:

```bash
cp helm/cloud-mcp/values.yaml helm/cloud-mcp/values.local.yaml
```

Set at minimum:

- `image.repository`
- `image.tag`
- `env.VAULT_ADDR`
- `secrets.data.VAULT_TOKEN`
- `env.COMMAND_LIMITS_DATABASE_URL` (or local-postgres toggle values)

3. Install or upgrade:

```bash
helm upgrade --install cloud-mcp ./helm/cloud-mcp -f helm/cloud-mcp/values.local.yaml
```

4. Verify:

```bash
kubectl rollout status deployment/cloud-mcp-cloud-mcp
kubectl logs deployment/cloud-mcp-cloud-mcp --tail=200
```

Notes:

- The chart mounts `cloud-wrap.config.json` from a ConfigMap at `/etc/cloud-mcp/cloud-wrap.config.json`.
- `VAULT_TOKEN` and `MCP_PROVIDER_AUTH_KEY` are provided by Kubernetes Secret (`secrets.data`).
- Default container args run MCP mode (`mcp --config /etc/cloud-mcp/cloud-wrap.config.json`).

## Configuration

Create `cloud-wrap.config.json` using `cloud-wrap.config.example.json` as a template.

```json
{
  "vault": {
    "module": "./external-vault.js",
    "options": {}
  },
  "providers": {
    "aws": {
      "command": "aws",
      "env": {
        "AWS_PROFILE": "default"
      },
      "defaultProfile": "default",
      "profileSupport": {
        "mode": "env",
        "envVar": "AWS_PROFILE"
      },
      "profiles": {
        "default": {
          "env": {
            "AWS_PROFILE": "default"
          },
          "users": []
        }
      }
    }
  }
}
```

If `vault.module` is present, the runtime will try to load that module first. The module should expose either `createVault`, a default factory, or a vault object with the same `get`/`set`/`snapshot` methods as the built-in service. If loading fails, the local in-memory vault is used.

This repo also includes a built-in external HashiCorp Vault adapter at `src/core/hashicorpVault.js`, mirrored after the `akoya-mcp` external vault setup. It is auto-selected when either:

- `VAULT_PROVIDER=external`
- both `VAULT_ADDR` and `VAULT_TOKEN` are set

Fail-closed behavior: when `VAULT_PROVIDER=external` and both `VAULT_ADDR` and `VAULT_TOKEN` are set, startup fails if the external vault module cannot be loaded or initialized. In this explicit external mode, it does not fall back to local in-memory vault.

`CLOUD_WRAP_VAULT_MODULE` still takes precedence over all auto-selection logic.

For external vault integrations, these environment variables are forwarded into the external vault `options` object when set:

- `VAULT_PROVIDER`
- `VAULT_ADDR`
- `VAULT_TOKEN`
- `VAULT_NAMESPACE`
- `VAULT_KV_MOUNT`
- `VAULT_KV_VERSION`
- `VAULT_SECRET_PATH`
- `COMMAND_LIMITS_LOCAL_POSTGRES_ENABLED`
- `COMMAND_LIMITS_LOCAL_POSTGRES_PORT`

Required vault key contract:

- Required environment variables for explicit external mode:
  - `VAULT_PROVIDER=external`
  - `VAULT_ADDR`
  - `VAULT_TOKEN`
- Required secret key at each provider path:
  - key name: `provider`
  - required object fields: `command` (string), `env` (object)
  - optional profile fields: `defaultProfile` (string), `profiles` (map), `profileSupport` (`mode=arg|env`, with `flag` or `envVar`)
  - optional per-profile access field: `profiles.<name>.users` (string array)
- Provider authorization key (when enabled):
  - set `MCP_PROVIDER_AUTH_KEY` to seed vault path `mcp.authorization.providerKey`
  - `get_provider` and `set_provider` requests must include `authorizationKey` matching that value

When using the built-in external adapter, `VAULT_SECRET_PATH` is treated as a base path and each cloud CLI provider is stored separately:

- `${VAULT_SECRET_PATH}/aws`
- `${VAULT_SECRET_PATH}/gcp`
- `${VAULT_SECRET_PATH}/azure`
- `${VAULT_SECRET_PATH}/oci`
- `${VAULT_SECRET_PATH}/alibaba`
- `${VAULT_SECRET_PATH}/digitalocean`
- `${VAULT_SECRET_PATH}/ibmcloud`
- `${VAULT_SECRET_PATH}/tencent`
- `${VAULT_SECRET_PATH}/huawei`

Each provider secret stores one object at key `provider` containing `command`, `env`, and optional profile fields.

Multi-profile provider behavior:

- `run_provider` and `run_<provider>` accept optional `profile`.
- `run_provider` and `run_<provider>` accept optional `user` for profile access checks.
- If `profile` is provided, runtime applies `profileSupport` to inject profile context via args or env.
- `profiles.<name>.args` and `profiles.<name>.env` are merged into execution.
- `profiles.<name>.users` controls profile access:
  - empty or missing array means profile is available to all users
  - non-empty array restricts profile use to those users
- If `profile` is omitted and `defaultProfile` is configured, that profile is used.

`CLOUD_WRAP_VAULT_MODULE` can also be used to override `vault.module` from config.

For a ready-made external profile, use `cloud-wrap.config.external-vault.example.json`.

Then run:

```bash
npm start -- --config cloud-wrap.config.json aws sts get-caller-identity
```

## Extend with additional providers

Add a provider in your config file:

```json
{
  "providers": {
    "do": {
      "command": "doctl",
      "env": {
        "DIGITALOCEAN_ACCESS_TOKEN": "<token>"
      }
    }
  }
}
```

Then call:

```bash
npm start -- run do account get
```

## Project structure

```text
src/
  index.js            # entry point
  mcp.js              # MCP stdio entry point
  program.js          # command definitions
  core/
    context.js        # runtime context creation
    execute.js        # provider CLI spawning
    mcp.js            # MCP tool registration and server startup
  config/
    providers.js      # built-in provider defaults
    loadConfig.js     # config loading and validation
  utils/
    logger.js         # pino logger setup
```
