#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
case "$(uname -m)" in
  x86_64) arch=x86_64 ;;
  aarch64|arm64) arch=aarch_64 ;;
  *) echo 'unsupported protoc architecture' >&2; exit 1 ;;
esac
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT HUP INT TERM
curl -fsSL "https://github.com/protocolbuffers/protobuf/releases/download/v25.1/protoc-25.1-linux-$arch.zip" -o "$output/protoc.zip"
unzip -q "$output/protoc.zip" -d "$output/protoc"
cp "$output/protoc/bin/protoc" /usr/local/bin/protoc
cp -R "$output/protoc/include/." /usr/local/include/
make tools
