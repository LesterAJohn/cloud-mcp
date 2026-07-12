import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const DEFAULT_COMMAND_LIMITS = {
  "aws.*": [],
  "azure.*": [],
  "gcp.*": [],
  "oci.*": [],
};

const commandLimitsSchema = z.object({
  "aws.*": z.array(z.string()).default([]),
  "azure.*": z.array(z.string()).default([]),
  "gcp.*": z.array(z.string()).default([]),
  "oci.*": z.array(z.string()).default([]),
});

export async function loadCommandLimits(commandLimitsPath) {
  if (!commandLimitsPath || !existsSync(commandLimitsPath)) {
    return commandLimitsSchema.parse(DEFAULT_COMMAND_LIMITS);
  }

  const raw = await readFile(commandLimitsPath, "utf8");
  const parsed = JSON.parse(raw);

  return commandLimitsSchema.parse({
    ...DEFAULT_COMMAND_LIMITS,
    ...parsed,
  });
}