#!/usr/bin/env bash
set -euo pipefail
source scripts/ci/common.sh
ci_install_cleanup
tar -cf - atheros-search scripts/ci/tasks | ci_run atheros-search-1 --rm -i -w /workspace/atheros-search golang:1.26-bookworm \
  sh -c 'mkdir -p /workspace && tar --no-same-owner -C /workspace -xf - && sh /workspace/scripts/ci/tasks/atheros-search-1.sh'
