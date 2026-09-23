pipeline {
  agent any
  options {
    disableConcurrentBuilds(abortPrevious: true)
    skipDefaultCheckout(true)
    timestamps()
    timeout(time: 90, unit: 'MINUTES')
  }
  environment {
    DOCKER_CONTEXT_NAME = 'integration-console-ci-docker'
    BUILDER = 'integration-console-http-host'
  }
  stages {
    stage('Checkout') {
      steps {
        deleteDir()
        checkout scm
      }
    }
    stage('Test') {
      parallel {
        stage('Atheros search') {
          steps {
            sh '''
              set -eu
              tar -cf - atheros-search | docker run --rm -i -w /workspace/atheros-search golang:1.26-bookworm \
                sh -c 'mkdir -p /workspace && tar --no-same-owner -C /workspace -xf - && go test ./...'
            '''
          }
        }
        stage('Atheros search UI') {
          steps {
            sh '''
              set -eu
              tar -cf - atheros-search-ui | docker run --rm -i -w /workspace/atheros-search-ui oven/bun:1.3.11 \
                sh -c 'mkdir -p /workspace && tar --no-same-owner -C /workspace -xf - && bun install --frozen-lockfile && bun run test && bun run build'
            '''
          }
        }
      }
    }
    stage('Publish immutable images') {
      when { branch 'main' }
      steps {
        sh '''
          set -eu
          test -n "${CI_REGISTRY:-}"
          mkdir -p artifacts
          revision="$(git rev-parse HEAD)"
          if docker context inspect "$DOCKER_CONTEXT_NAME" >/dev/null 2>&1; then
            docker context rm --force "$DOCKER_CONTEXT_NAME" >/dev/null
          fi
          docker context create "$DOCKER_CONTEXT_NAME" \
            --docker "host=$DOCKER_HOST,ca=$DOCKER_CERT_PATH/ca.pem,cert=$DOCKER_CERT_PATH/cert.pem,key=$DOCKER_CERT_PATH/key.pem" >/dev/null
          docker_cmd() {
            env -u DOCKER_HOST -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH \
              DOCKER_CONTEXT="$DOCKER_CONTEXT_NAME" docker "$@"
          }
          printf '[registry."%s"]\n  http = true\n  insecure = true\n' "$CI_REGISTRY" > artifacts/buildkitd.toml
          if ! docker_cmd buildx inspect "$BUILDER" >/dev/null 2>&1; then
            docker_cmd buildx create --name "$BUILDER" --driver docker-container \
              --driver-opt network=host --buildkitd-config artifacts/buildkitd.toml >/dev/null
          fi
          docker_cmd buildx inspect "$BUILDER" --bootstrap >/dev/null
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
            --metadata-file artifacts/atheros-search-ui.json --push atheros-search-ui
        '''
        archiveArtifacts artifacts: 'artifacts/*.json', fingerprint: true
      }
    }
  }
}
