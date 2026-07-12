import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CANONICAL_SECTIONS = [
  "aws.*",
  "gcp.*",
  "azure.*",
  "oci.*",
  "alibaba.*",
  "digitalocean.*",
  "ibmcloud.*",
  "tencent.*",
  "huawei.*",
];

function normalizeProviderSection(provider) {
  const raw = String(provider ?? "").trim().toLowerCase();
  if (raw === "aws" || raw === "aws.*") {
    return "aws.*";
  }

  if (raw === "gcp" || raw === "gcp.*" || raw === "gcloud" || raw === "gcloud.*") {
    return "gcp.*";
  }

  if (raw === "azure" || raw === "azure.*" || raw === "az" || raw === "az.*") {
    return "azure.*";
  }

  if (raw === "oci" || raw === "oci.*") {
    return "oci.*";
  }

  if (raw === "alibaba" || raw === "alibaba.*" || raw === "aliyun" || raw === "aliyun.*") {
    return "alibaba.*";
  }

  if (raw === "digitalocean" || raw === "digitalocean.*" || raw === "doctl" || raw === "doctl.*") {
    return "digitalocean.*";
  }

  if (raw === "ibmcloud" || raw === "ibmcloud.*") {
    return "ibmcloud.*";
  }

  if (raw === "tencent" || raw === "tencent.*" || raw === "tccli" || raw === "tccli.*") {
    return "tencent.*";
  }

  if (raw === "huawei" || raw === "huawei.*" || raw === "hcloud" || raw === "hcloud.*") {
    return "huawei.*";
  }

  throw new Error(`Unsupported provider section '${provider}'`);
}

function normalizeLimits(limits) {
  return {
    "aws.*": Array.isArray(limits?.["aws.*"]) ? limits["aws.*"] : [],
    "gcp.*": Array.isArray(limits?.["gcp.*"]) ? limits["gcp.*"] : [],
    "azure.*": Array.isArray(limits?.["azure.*"]) ? limits["azure.*"] : [],
    "oci.*": Array.isArray(limits?.["oci.*"]) ? limits["oci.*"] : [],
    "alibaba.*": Array.isArray(limits?.["alibaba.*"]) ? limits["alibaba.*"] : [],
    "digitalocean.*": Array.isArray(limits?.["digitalocean.*"]) ? limits["digitalocean.*"] : [],
    "ibmcloud.*": Array.isArray(limits?.["ibmcloud.*"]) ? limits["ibmcloud.*"] : [],
    "tencent.*": Array.isArray(limits?.["tencent.*"]) ? limits["tencent.*"] : [],
    "huawei.*": Array.isArray(limits?.["huawei.*"]) ? limits["huawei.*"] : [],
  };
}

function resolveInternalPath(ctx) {
  return ctx.commandLimitsConfig.path;
}

function resolveExternalSource(ctx) {
  return ctx.commandLimitsConfig.source;
}

async function writeToFileTarget(targetPath, payload) {
  const content = JSON.stringify(payload, null, 2);
  if (targetPath.startsWith("file://")) {
    await writeFile(fileURLToPath(targetPath), `${content}\n`, "utf8");
    return;
  }

  await writeFile(path.resolve(process.cwd(), targetPath), `${content}\n`, "utf8");
}

async function writeToHttpTarget(targetUrl, payload) {
  const method = process.env.CLOUD_COMMAND_LIMITS_PUSH_HTTP_METHOD ?? "PUT";
  const headers = {
    "Content-Type": "application/json",
  };

  if (process.env.CLOUD_COMMAND_LIMITS_PUSH_TOKEN) {
    headers.Authorization = `Bearer ${process.env.CLOUD_COMMAND_LIMITS_PUSH_TOKEN}`;
  }

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `Failed to push command limits to external source: ${response.status} ${message || response.statusText}`,
    );
  }
}

async function pushLimitsToTarget(ctx, target, limits) {
  if (target === "internal") {
    const internalPath = resolveInternalPath(ctx);
    await writeToFileTarget(internalPath, limits);
    return { target: "internal", location: internalPath };
  }

  const source = resolveExternalSource(ctx);
  if (!source) {
    throw new Error("External command-limits source is not configured");
  }

  if (source.startsWith("http://") || source.startsWith("https://")) {
    await writeToHttpTarget(source, limits);
  } else {
    await writeToFileTarget(source, limits);
  }

  return { target: "external", location: source };
}

export async function getCommandLimits(ctx) {
  const limits = await ctx.commandLimitsStore.getAll();
  return normalizeLimits(limits);
}

export async function setProviderCommandLimits(ctx, provider, allowedPrefixes) {
  const providerSection = normalizeProviderSection(provider);
  const current = normalizeLimits(await ctx.commandLimitsStore.getAll());
  current[providerSection] = Array.isArray(allowedPrefixes)
    ? [...new Set(allowedPrefixes.filter((entry) => typeof entry === "string"))]
    : [];
  await ctx.commandLimitsStore.sync(current);
  return normalizeLimits(await ctx.commandLimitsStore.getAll());
}

export async function replaceCommandLimits(ctx, nextLimits) {
  const normalized = normalizeLimits(nextLimits);
  await ctx.commandLimitsStore.sync(normalized);
  return normalizeLimits(await ctx.commandLimitsStore.getAll());
}

export async function forcePushCommandLimits(ctx, target = "auto") {
  const limits = normalizeLimits(await ctx.commandLimitsStore.getAll());
  const effectiveTarget = target === "auto" ? (resolveExternalSource(ctx) ? "external" : "internal") : target;

  if (effectiveTarget !== "internal" && effectiveTarget !== "external") {
    throw new Error(`Unsupported push target '${target}'`);
  }

  const result = await pushLimitsToTarget(ctx, effectiveTarget, limits);
  return {
    ...result,
    limits,
  };
}

export function getSupportedCommandLimitSections() {
  return [...CANONICAL_SECTIONS];
}