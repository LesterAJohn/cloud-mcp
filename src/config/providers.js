import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../..");

function resolveProviderCommand(provider, commandName, envOverride) {
  const localBinary = path.join(repoRoot, "mcp", provider, "bin", commandName);
  if (existsSync(localBinary)) {
    return localBinary;
  }

  return envOverride || commandName;
}

export const defaultProviders = {
  aws: {
    command: resolveProviderCommand("aws", "aws", process.env.AWS_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "env",
      envVar: "AWS_PROFILE",
    },
  },
  gcp: {
    command: resolveProviderCommand("gcp", "gcloud", process.env.GCP_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "env",
      envVar: "CLOUDSDK_ACTIVE_CONFIG_NAME",
    },
  },
  azure: {
    command: resolveProviderCommand("azure", "az", process.env.AZURE_CLI_BIN),
    env: {},
  },
  oci: {
    command: resolveProviderCommand("oci", "oci", process.env.OCI_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "env",
      envVar: "OCI_CLI_PROFILE",
    },
  },
  alibaba: {
    command: resolveProviderCommand("alibaba", "aliyun", process.env.ALIBABA_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "arg",
      flag: "--profile",
    },
  },
  digitalocean: {
    command: resolveProviderCommand("digitalocean", "doctl", process.env.DIGITALOCEAN_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "arg",
      flag: "--context",
    },
  },
  ibmcloud: {
    command: resolveProviderCommand("ibmcloud", "ibmcloud", process.env.IBMCLOUD_CLI_BIN),
    env: {},
  },
  tencent: {
    command: resolveProviderCommand("tencent", "tccli", process.env.TENCENT_CLI_BIN),
    env: {},
    profileSupport: {
      mode: "arg",
      flag: "--profile",
    },
  },
  huawei: {
    command: resolveProviderCommand("huawei", "hcloud", process.env.HUAWEI_CLI_BIN),
    env: {},
  },
};
