#!/bin/sh
set -eu
apt-get update
apt-get install -y --no-install-recommends unzip
sh scripts/ci-tools.sh
make quality-go
