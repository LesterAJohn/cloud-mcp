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
  },
  gcp: {
    command: resolveProviderCommand("gcp", "gcloud", process.env.GCP_CLI_BIN),
    env: {},
  },
  azure: {
    command: resolveProviderCommand("azure", "az", process.env.AZURE_CLI_BIN),
    env: {},
  },
  oci: {
    command: resolveProviderCommand("oci", "oci", process.env.OCI_CLI_BIN),
    env: {},
  },
};
