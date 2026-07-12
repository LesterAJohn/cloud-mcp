#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MCP_DIR="$ROOT_DIR/mcp"
ARCH="${TARGETARCH:-$(uname -m)}"

AWS_CLI_VERSION="${AWS_CLI_VERSION:-2.28.2}"
GCLOUD_VERSION="${GCLOUD_VERSION:-486.0.0}"
OCI_CLI_VERSION="${OCI_CLI_VERSION:-3.68.0}"
AZURE_CLI_VERSION="${AZURE_CLI_VERSION:-2.75.0}"

mkdir -p "$MCP_DIR/aws/bin" "$MCP_DIR/gcp/bin" "$MCP_DIR/azure/bin" "$MCP_DIR/oci/bin"

normalize_arch() {
  case "$1" in
    x86_64|amd64) echo "x86_64" ;;
    aarch64|arm64) echo "arm64" ;;
    *)
      echo "Unsupported arch: $1" >&2
      exit 1
      ;;
  esac
}

ARCH_NORMALIZED="$(normalize_arch "$ARCH")"

require_tools() {
  local missing=0
  for tool in curl tar unzip python3; do
    if ! command -v "$tool" >/dev/null 2>&1; then
      echo "Missing required tool: $tool" >&2
      missing=1
    fi
  done

  if [[ "$missing" -ne 0 ]]; then
    exit 1
  fi
}

install_aws() {
  local tmp_dir aws_zip url
  tmp_dir="$(mktemp -d)"

  if [[ "$ARCH_NORMALIZED" == "arm64" ]]; then
    aws_zip="awscli-exe-linux-aarch64-${AWS_CLI_VERSION}.zip"
  else
    aws_zip="awscli-exe-linux-x86_64-${AWS_CLI_VERSION}.zip"
  fi

  url="https://awscli.amazonaws.com/${aws_zip}"
  echo "Installing AWS CLI from $url"
  curl -fsSL "$url" -o "$tmp_dir/awscliv2.zip"
  unzip -q "$tmp_dir/awscliv2.zip" -d "$tmp_dir"

  "$tmp_dir/aws/install" --install-dir "$MCP_DIR/aws/dist" --bin-dir "$MCP_DIR/aws/bin" --update
  rm -rf "$tmp_dir"
}

install_gcloud() {
  local tmp_dir tar_name url
  tmp_dir="$(mktemp -d)"

  if [[ "$ARCH_NORMALIZED" == "arm64" ]]; then
    tar_name="google-cloud-cli-${GCLOUD_VERSION}-linux-arm.tar.gz"
  else
    tar_name="google-cloud-cli-${GCLOUD_VERSION}-linux-x86_64.tar.gz"
  fi

  url="https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/${tar_name}"
  echo "Installing Google Cloud CLI from $url"
  curl -fsSL "$url" -o "$tmp_dir/gcloud.tar.gz"
  mkdir -p "$MCP_DIR/gcp/dist"
  tar -xzf "$tmp_dir/gcloud.tar.gz" -C "$MCP_DIR/gcp/dist"

  ln -sf "$MCP_DIR/gcp/dist/google-cloud-sdk/bin/gcloud" "$MCP_DIR/gcp/bin/gcloud"
  rm -rf "$tmp_dir"
}

install_azure() {
  local venv_dir
  venv_dir="$MCP_DIR/azure/venv"

  echo "Installing Azure CLI ${AZURE_CLI_VERSION} into Python venv"
  python3 -m venv "$venv_dir"
  "$venv_dir/bin/pip" install --no-cache-dir --upgrade pip
  "$venv_dir/bin/pip" install --no-cache-dir "azure-cli==${AZURE_CLI_VERSION}"

  ln -sf "$venv_dir/bin/az" "$MCP_DIR/azure/bin/az"
}

install_oci() {
  local tmp_dir url
  tmp_dir="$(mktemp -d)"
  url="https://raw.githubusercontent.com/oracle/oci-cli/v${OCI_CLI_VERSION}/scripts/install/install.sh"

  echo "Installing OCI CLI from $url"
  curl -fsSL "$url" -o "$tmp_dir/oci-install.sh"
  chmod +x "$tmp_dir/oci-install.sh"

  bash "$tmp_dir/oci-install.sh" --accept-all-defaults --install-dir "$MCP_DIR/oci/dist" --exec-dir "$MCP_DIR/oci/bin"
  rm -rf "$tmp_dir"
}

print_versions() {
  echo "Installed binary checks:"
  "$MCP_DIR/aws/bin/aws" --version || true
  "$MCP_DIR/gcp/bin/gcloud" --version || true
  "$MCP_DIR/azure/bin/az" version || true
  "$MCP_DIR/oci/bin/oci" --version || true
}

require_tools
install_aws
install_gcloud
install_azure
install_oci
print_versions

echo "All provider CLIs were installed into mcp/<provider>/bin"
