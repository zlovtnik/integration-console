#!/usr/bin/env bash
set -euo pipefail
source scripts/ci/common.sh
ci_prepare_publish
revision="$(git rev-parse HEAD)"
cleanup_build_context() {
  rm -rf artifacts/build-context
}
trap cleanup_build_context EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -p artifacts/build-context/apps/integration-console
tar -cf - atheros-search | tar -C artifacts/build-context/apps/integration-console -xf -
docker_cmd buildx build --builder "$BUILDER" --platform linux/amd64 \
  --file artifacts/build-context/apps/integration-console/atheros-search/Dockerfile \
  --tag "$CI_REGISTRY/atheros-search:$revision" \
  --metadata-file artifacts/atheros-search.json --push artifacts/build-context
docker_cmd buildx build --builder "$BUILDER" --platform linux/amd64 \
  --file atheros-search-ui/Dockerfile --tag "$CI_REGISTRY/atheros-search-ui:$revision" \
  --build-arg VITE_API_BASE= --build-arg 'VITE_APP_TITLE=atheros search' \
  --build-arg VITE_KEYCLOAK_URL=https://gateway.rclabs.uk \
  --build-arg VITE_KEYCLOAK_REALM=middleware \
  --build-arg VITE_KEYCLOAK_CLIENT_ID=atheros-search-ui \
  --metadata-file artifacts/atheros-search-ui.json --push .
