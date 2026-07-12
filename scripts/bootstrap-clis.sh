#!/usr/bin/env sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"

link_cli() {
  provider="$1"
  command_name="$2"
  env_bin="$3"

  bin_path="${env_bin:-}"

  if [ -z "$bin_path" ]; then
    if command -v "$command_name" >/dev/null 2>&1; then
      bin_path="$(command -v "$command_name")"
    else
      echo "skip: $provider ($command_name not found on PATH)"
      return 0
    fi
  fi

  target_dir="$ROOT_DIR/mcp/$provider/bin"
  target_path="$target_dir/$command_name"

  mkdir -p "$target_dir"
  ln -sf "$bin_path" "$target_path"

  echo "linked: $provider -> $target_path"
}

link_cli aws aws "${AWS_CLI_BIN:-}"
link_cli gcp gcloud "${GCP_CLI_BIN:-}"
link_cli azure az "${AZURE_CLI_BIN:-}"
link_cli oci oci "${OCI_CLI_BIN:-}"

echo "done: repository-local CLI links are ready under mcp/<provider>/bin"
