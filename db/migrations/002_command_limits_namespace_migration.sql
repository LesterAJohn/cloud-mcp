-- Standalone migration for existing databases.
-- Creates dedicated namespace/table for command limits and copies legacy rows.

CREATE SCHEMA IF NOT EXISTS cloud_mcp;

CREATE TABLE IF NOT EXISTS cloud_mcp.command_limits (
  provider_prefix TEXT PRIMARY KEY,
  allowed_prefixes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO cloud_mcp.command_limits (provider_prefix, allowed_prefixes, updated_at)
SELECT provider_prefix, allowed_prefixes, COALESCE(updated_at, NOW())
FROM public.command_limits
WHERE to_regclass('public.command_limits') IS NOT NULL
ON CONFLICT (provider_prefix) DO NOTHING;

INSERT INTO cloud_mcp.command_limits (provider_prefix, allowed_prefixes)
VALUES
  ('aws.*', '[]'::jsonb),
  ('gcp.*', '[]'::jsonb),
  ('azure.*', '[]'::jsonb),
  ('oci.*', '[]'::jsonb),
  ('alibaba.*', '[]'::jsonb),
  ('digitalocean.*', '[]'::jsonb),
  ('ibmcloud.*', '[]'::jsonb),
  ('tencent.*', '[]'::jsonb),
  ('huawei.*', '[]'::jsonb)
ON CONFLICT (provider_prefix) DO NOTHING;
