import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";

const DEFAULT_COMMAND_LIMITS_PATH = "mcp/cloud-command-limits.json";

export const DEFAULT_COMMAND_LIMITS = {
  "alibaba.*": [],
  "aws.*": [],
  "azure.*": [],
  "digitalocean.*": [],
  "gcp.*": [],
  "huawei.*": [],
  "ibmcloud.*": [],
  "oci.*": [],
  "tencent.*": [],
};

const commandLimitsSchema = z.object({
  "alibaba.*": z.array(z.string()).optional(),
  "aws.*": z.array(z.string()).optional(),
  "azure.*": z.array(z.string()).optional(),
  "digitalocean.*": z.array(z.string()).optional(),
  "gcp.*": z.array(z.string()).optional(),
  "hcloud.*": z.array(z.string()).optional(),
  "huawei.*": z.array(z.string()).optional(),
  "ibmcloud.*": z.array(z.string()).optional(),
  "oci.*": z.array(z.string()).optional(),
  "tencent.*": z.array(z.string()).optional(),
  "aliyun.*": z.array(z.string()).optional(),
  "az.*": z.array(z.string()).optional(),
  "doctl.*": z.array(z.string()).optional(),
  "gcloud.*": z.array(z.string()).optional(),
  "tccli.*": z.array(z.string()).optional(),
}).passthrough();

function hasOwnKey(input, key) {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string"))];
}

function resolveProviderSection(raw, parsed, canonicalKey, aliasKey) {
  if (hasOwnKey(raw, canonicalKey)) {
    return parsed[canonicalKey] ?? [];
  }

  if (aliasKey && hasOwnKey(raw, aliasKey)) {
    return parsed[aliasKey] ?? [];
  }

  return DEFAULT_COMMAND_LIMITS[canonicalKey];
}

function normalizeCommandLimits(parsedRaw) {
  const parsed = commandLimitsSchema.parse(parsedRaw);

  return {
    "alibaba.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "alibaba.*", "aliyun.*")),
    "aws.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "aws.*")),
    "azure.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "azure.*", "az.*")),
    "digitalocean.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "digitalocean.*", "doctl.*")),
    "gcp.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "gcp.*", "gcloud.*")),
    "huawei.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "huawei.*", "hcloud.*")),
    "ibmcloud.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "ibmcloud.*")),
    "oci.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "oci.*")),
    "tencent.*": uniqueStrings(resolveProviderSection(parsedRaw, parsed, "tencent.*", "tccli.*")),
  };
}

async function loadFromUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Failed to load command limits from ${url}: ${response.status} ${message || response.statusText}`);
  }

  return response.json();
}

async function loadFromFile(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function loadCommandLimitsDocument(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return loadFromUrl(source);
  }

  if (source.startsWith("file://")) {
    return loadFromFile(new URL(source));
  }

  return loadFromFile(source);
}

export async function loadCommandLimits(input = {}) {
  const options = typeof input === "string" ? { commandLimitsPath: input } : input;
  const commandLimitsPath = options.commandLimitsPath ?? DEFAULT_COMMAND_LIMITS_PATH;
  const commandLimitsSource = options.commandLimitsSource;

  if (commandLimitsSource) {
    const parsedRaw = await loadCommandLimitsDocument(commandLimitsSource);
    return normalizeCommandLimits(parsedRaw);
  }

  if (!commandLimitsPath || !existsSync(commandLimitsPath)) {
    return DEFAULT_COMMAND_LIMITS;
  }

  const parsedRaw = await loadCommandLimitsDocument(commandLimitsPath);
  return normalizeCommandLimits(parsedRaw);
}