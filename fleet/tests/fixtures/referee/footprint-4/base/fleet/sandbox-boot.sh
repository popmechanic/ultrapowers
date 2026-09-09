#!/usr/bin/env bash
# fleet/sandbox-boot.sh — a stand-in for the boot script.
set -euo pipefail

main() {
  echo "boot: ${1:-none}"
}

main "$@"
