package embed

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
)

// DefaultMaxTokens is the llama.cpp model context. Chunks deliberately leave
// room for the backend's special tokens.
const DefaultMaxTokens = 512

// ChunkTokenLimit is the maximum tokenizer-counted content supplied for one
// source chunk. It is intentionally independent of character count.
const ChunkTokenLimit = 480

// RequestTokenLimit is the maximum tokenizer-counted content in one embedding
// request. llama.cpp applies its physical batch limit to this aggregate.
const RequestTokenLimit = 4096

// RequestPackTokenLimit is the packing budget used when grouping chunks into
// one /v1/embeddings call. llama.cpp serves a request from a single slot, so a
// request carrying RequestTokenLimit tokens occupies one slot for its whole
// duration while the remaining slots idle. Packing to about one slot context
// keeps every slot busy instead of one. RequestTokenLimit stays as the hard
// safety bound for a single chunk.
const RequestPackTokenLimit = 512

// DefaultRequestConcurrency is how many embedding requests a client keeps in
// flight. It matches the backend slot count by default.
const DefaultRequestConcurrency = 4

// DefaultTokenizerConcurrency bounds concurrent tokenizer round trips.
// /tokenize and /detokenize do not consume embedding slots, but they still
// share the backend process, so fan-out is wider than the request budget and
// never unbounded.
const DefaultTokenizerConcurrency = 8

type Tokenizer interface {
	Tokenize(context.Context, string) ([]int, error)
	Detokenize(context.Context, []int) (string, error)
}

// ChunkText uses the backend tokenizer rather than a heuristic, then rebuilds
// each exact token range through /detokenize. This preserves every source token
// and keeps a model input below the effective 512-token context.
func ChunkText(ctx context.Context, tokenizer Tokenizer, text string) ([]TokenChunk, error) {
	chunked, err := ChunkTexts(ctx, tokenizer, []string{text}, 1, 0)
	if err != nil {
		return nil, err
	}
	return chunked[0], nil
}

// ChunkTexts chunks many sources concurrently while preserving input order.
// maxChunks bounds one source; a source above the bound fails fast with
// *OversizedInputError before any /detokenize round trip is spent on it.
// A maxChunks of zero or less disables the bound.
func ChunkTexts(ctx context.Context, tokenizer Tokenizer, texts []string, concurrency, maxChunks int) ([][]TokenChunk, error) {
	out := make([][]TokenChunk, len(texts))
	if len(texts) == 0 {
		return out, nil
	}
	err := runBounded(ctx, concurrency, len(texts), func(ctx context.Context, index int) error {
		chunks, err := chunkOne(ctx, tokenizer, texts[index], maxChunks)
		if err != nil {
			if errors.Is(err, errChunkBudget) {
				return &OversizedInputError{Index: index, Cause: err}
			}
			return err
		}
		out[index] = chunks
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func chunkOne(ctx context.Context, tokenizer Tokenizer, text string, maxChunks int) ([]TokenChunk, error) {
	tokens, err := tokenizer.Tokenize(ctx, text)
	if err != nil {
		return nil, fmt.Errorf("tokenize embedding source: %w", err)
	}
	if len(tokens) == 0 {
		if strings.TrimSpace(text) != "" {
			return nil, fmt.Errorf("tokenize embedding source: no tokens for non-empty text")
		}
		return []TokenChunk{{Text: text}}, nil
	}
	chunkCount := (len(tokens) + ChunkTokenLimit - 1) / ChunkTokenLimit
	if maxChunks > 0 && chunkCount > maxChunks {
		return nil, fmt.Errorf("%w: source tokenizes to %d chunks, budget is %d", errChunkBudget, chunkCount, maxChunks)
	}
	chunks := make([]TokenChunk, chunkCount)
	err = runBounded(ctx, DefaultTokenizerConcurrency, len(chunks), func(ctx context.Context, index int) error {
		start := index * ChunkTokenLimit
		end := start + ChunkTokenLimit
		if end > len(tokens) {
			end = len(tokens)
		}
		content, err := tokenizer.Detokenize(ctx, tokens[start:end])
		if err != nil {
			return fmt.Errorf("detokenize embedding source tokens %d:%d: %w", start, end, err)
		}
		chunks[index] = TokenChunk{Text: content, TokenCount: end - start}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return chunks, nil
}

// runBounded executes fn for indexes [0,total) with at most concurrency
// goroutines in flight. Results are written by index, so callers keep input
// order. The first error cancels the rest and is returned.
func runBounded(ctx context.Context, concurrency, total int, fn func(context.Context, int) error) error {
	if total <= 0 {
		return nil
	}
	if concurrency < 1 {
		concurrency = 1
	}
	if concurrency > total {
		concurrency = total
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		firstErr error
	)
	sem := make(chan struct{}, concurrency)
	for index := 0; index < total; index++ {
		wg.Add(1)
		go func(index int) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			if err := fn(ctx, index); err != nil {
				mu.Lock()
				if firstErr == nil {
					firstErr = err
				}
				mu.Unlock()
				cancel()
			}
		}(index)
	}
	wg.Wait()
	if firstErr != nil {
		return firstErr
	}
	return ctx.Err()
}

type TokenChunk struct {
	Text       string
	TokenCount int
}
