LINT_VERSION := 2.13.2
GO ?= go
PYTHON ?= python3
export PATH := $(shell $(GO) env GOPATH)/bin:$(PATH)

.PHONY: quality quality-go fmt-check vet test test-race lint boundaries proto proto-check stack-contract db-contract fixtures fixtures-go ui-check build duplication-report tools
quality: quality-go fixtures ui-check
quality-go: fmt-check vet test-race lint boundaries proto-check fixtures-go
fmt-check:
	@dirs="$$($(GO) list -tags=dbcontract,stackcontract -f '{{.Dir}}' ./...)" || exit 1; \
	unformatted="$$(printf '%s\n' "$$dirs" | xargs -I@DIR@ find @DIR@ -maxdepth 1 -name '*.go' -exec gofmt -l {} +)" || exit 1; \
	test -z "$$unformatted" || { printf '%s\n' "$$unformatted"; echo 'Run gofmt on the listed Go source files'; exit 1; }
vet:
	$(GO) vet ./...
test:
	$(GO) test ./...
test-race:
	$(GO) test -race ./...
lint:
	@golangci-lint version | grep -q 'version $(LINT_VERSION) ' || { echo 'golangci-lint $(LINT_VERSION) is required'; exit 1; }
	golangci-lint run ./...
	golangci-lint run --build-tags=dbcontract,stackcontract ./...
boundaries:
	$(GO) test ./tests/architecture -count=1
proto:
	sh scripts/proto.sh generate
proto-check:
	sh scripts/proto.sh check
stack-contract:
	@test -n "$(ATHSEARCH_STACK_ROOT)" || { echo 'ATHSEARCH_STACK_ROOT is required'; exit 1; }
	ATHSEARCH_STACK_ROOT="$(ATHSEARCH_STACK_ROOT)" $(GO) test -tags=stackcontract ./tests/contracts -count=1
db-contract:
	@test -n "$(ATHSEARCH_STACK_ROOT)" || { echo 'ATHSEARCH_STACK_ROOT is required'; exit 1; }
	$(PYTHON) "$(ATHSEARCH_STACK_ROOT)/scripts/tests/test_atheros_reporting.py" --required
fixtures-go:
	$(GO) test ./tests/compatibility -count=1
fixtures: fixtures-go
	cd ../atheros-search-ui && bun run test -- tests/unit/contracts.test.ts
ui-check:
	cd ../atheros-search-ui && bun run test && bun run build
build:
	$(GO) build -o /tmp/atheros-search-server ./cmd/server
duplication-report:
	$(PYTHON) scripts/duplication_report.py
tools:
	$(GO) install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@v$(LINT_VERSION)
	$(GO) install google.golang.org/protobuf/cmd/protoc-gen-go@v1.36.11
	$(GO) install google.golang.org/grpc/cmd/protoc-gen-go-grpc@v1.6.2
