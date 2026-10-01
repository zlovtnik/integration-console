#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
test "$(protoc --version)" = 'libprotoc 25.1' || { echo 'protoc 25.1 is required' >&2; exit 1; }
test "$(protoc-gen-go --version)" = 'protoc-gen-go v1.36.11' || { echo 'protoc-gen-go 1.36.11 is required' >&2; exit 1; }
test "$(protoc-gen-go-grpc --version)" = 'protoc-gen-go-grpc 1.6.2' || { echo 'protoc-gen-go-grpc 1.6.2 is required' >&2; exit 1; }
mode=${1:-check}
case "$mode" in check|generate) ;; *) echo 'usage: proto.sh check|generate' >&2; exit 1;; esac
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT HUP INT TERM
protoc -I proto --go_out="$output" --go_opt=paths=source_relative \
  --go-grpc_out="$output" --go-grpc_opt=paths=source_relative \
  proto/atheros/search/v1/search.proto
if [ "$mode" = generate ]; then
  cp "$output/atheros/search/v1/search.pb.go" proto/atheros/search/v1/search.pb.go
  cp "$output/atheros/search/v1/search_grpc.pb.go" proto/atheros/search/v1/search_grpc.pb.go
else
  diff -u proto/atheros/search/v1/search.pb.go "$output/atheros/search/v1/search.pb.go"
  diff -u proto/atheros/search/v1/search_grpc.pb.go "$output/atheros/search/v1/search_grpc.pb.go"
fi
