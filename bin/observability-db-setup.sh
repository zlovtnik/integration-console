#!/bin/sh
set -eu

started_ms="$(ruby -e 'puts (Process.clock_gettime(Process::CLOCK_MONOTONIC) * 1000).round')"
status="success"

if ! bin/rails db:prepare; then
  status="failure"
fi

finished_ms="$(ruby -e 'puts (Process.clock_gettime(Process::CLOCK_MONOTONIC) * 1000).round')"
duration_ms="$((finished_ms - started_ms))"

bin/rails runner "Observability::JobMetrics.record(job: 'integration_console_db_setup', status: '$status', duration_ms: $duration_ms)"

if [ "$status" != "success" ]; then
  exit 1
fi
