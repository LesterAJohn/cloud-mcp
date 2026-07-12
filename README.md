# cloud-mcp

A Node.js skeleton for wrapping multiple cloud CLIs behind one command surface.

## What this gives you

- Unified CLI entrypoint (`cloud-wrap`)
- Provider pass-through commands for AWS, GCP, Azure, and OCI
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
npm run mcp
```

## Repository-local CLI layout

This project can keep provider CLI entrypoints under `mcp/<provider>/bin`.

- `mcp/aws/bin/aws`
- `mcp/gcp/bin/gcloud`
- `mcp/azure/bin/az`
- `mcp/oci/bin/oci`

Run the bootstrap command to create links from your installed CLIs into this structure:

```bash
npm run bootstrap:clis
```

Or pull and install all CLIs directly into the structure:

```bash
npm run install:clis
```

At runtime, provider resolution order is:

1. `mcp/<provider>/bin/<cli>` when present
2. `<PROVIDER>_CLI_BIN` environment override
3. CLI from `PATH`

Shared command limits live in [mcp/cloud-command-limits.json](/Users/lesterjohn/Documents/GitHub/cloud-mcp/mcp/cloud-command-limits.json).

- Sections are keyed by provider prefix: `aws.*`, `azure.*`, `gcp.*`, `oci.*`
- If a section is an empty array, all commands for that provider are allowed
- If a section contains entries, only matching prefixes are allowed
- Entries may be written as full prefixes like `aws.s3` or shorthand like `s3` within the `aws.*` section

How to fill out the file:

1. Allow everything for every cloud:

```json
{
  "aws.*": [],
  "azure.*": [],
  "gcp.*": [],
  "oci.*": []
}
```

2. Restrict AWS and GCP, leave Azure and OCI open:

```json
{
  "aws.*": ["s3", "sts.get-caller-identity"],
  "azure.*": [],
  "gcp.*": ["projects", "compute.instances.list"],
  "oci.*": []
}
```

3. Use full provider-prefixed entries explicitly:

```json
{
  "aws.*": ["aws.s3", "aws.sts.get-caller-identity"],
  "azure.*": [],
  "gcp.*": ["projects", "compute.instances.list"],
  "oci.*": ["oci.iam"]
}
```

4. Lock each provider to a narrow subset:

```json
{
  "aws.*": ["ec2.describe-instances", "s3.ls"],
  "azure.*": ["vm", "account.show"],
  "gcp.*": ["projects.list"],
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
```

### Provider shorthands

```bash
npm start -- aws s3 ls
npm start -- gcp projects list
npm start -- azure account show
npm start -- oci iam region list
```

## MCP server

Start the MCP server with:

```bash
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

Provider vault authorization:

- Set `MCP_PROVIDER_AUTH_KEY` to store an authorization key in vault at startup.
- When configured, `get_provider` and `set_provider` require `authorizationKey` in the request input.
- Requests with missing or invalid keys are rejected.

## Single container setup

This repository is set up to run as a single container image that includes:

- Node.js runtime
- cloud-mcp application
- AWS, GCP, Azure, and OCI CLIs inside `mcp/<provider>/bin`

Build the image:

```bash
docker build -t cloud-mcp:local .
```

Run MCP mode (default):

```bash
docker run --rm -i cloud-mcp:local
```

Run direct CLI mode:

```bash
docker run --rm cloud-mcp:local cli list
docker run --rm cloud-mcp:local cli aws sts get-caller-identity
```

The container entrypoint supports:

- `mcp` for `node src/mcp.js`
- `cli` for `node src/index.js`
- Any other first argument is treated as direct CLI arguments for backward compatibility

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

Required vault key contract:

- Required environment variables for explicit external mode:
  - `VAULT_PROVIDER=external`
  - `VAULT_ADDR`
  - `VAULT_TOKEN`
- Required secret key at each provider path:
  - key name: `provider`
  - required object fields: `command` (string), `env` (object)
- Provider authorization key (when enabled):
  - set `MCP_PROVIDER_AUTH_KEY` to seed vault path `mcp.authorization.providerKey`
  - `get_provider` and `set_provider` requests must include `authorizationKey` matching that value

When using the built-in external adapter, `VAULT_SECRET_PATH` is treated as a base path and each cloud CLI provider is stored separately:

- `${VAULT_SECRET_PATH}/aws`
- `${VAULT_SECRET_PATH}/gcp`
- `${VAULT_SECRET_PATH}/azure`
- `${VAULT_SECRET_PATH}/oci`

Each provider secret stores one object at key `provider` containing `command` and `env`.

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
