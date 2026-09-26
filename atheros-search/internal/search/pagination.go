package search

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
)

const (
	defaultPageSize = 500
	maxPageSize     = 1000
)

type pageCursor struct {
	Version     int    `json:"v"`
	Resource    string `json:"r"`
	Fingerprint string `json:"f"`
	NodeAfter   string `json:"n,omitempty"`
	EdgeAfter   string `json:"e,omitempty"`
	DeviceAfter string `json:"d,omitempty"`
	NodesDone   bool   `json:"nd,omitempty"`
	EdgesDone   bool   `json:"ed,omitempty"`
}

func pageFingerprint(value any) (string, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(encoded)
	return hex.EncodeToString(sum[:]), nil
}

func encodePageCursor(cursor pageCursor) (string, error) {
	encoded, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(encoded), nil
}

func decodePageCursor(encoded, resource, fingerprint string) (pageCursor, error) {
	if encoded == "" {
		return pageCursor{Version: 1, Resource: resource, Fingerprint: fingerprint}, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return pageCursor{}, errors.New("invalid page_cursor")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	var cursor pageCursor
	if err := decoder.Decode(&cursor); err != nil {
		return pageCursor{}, errors.New("invalid page_cursor")
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return pageCursor{}, errors.New("invalid page_cursor")
	}
	if cursor.Version != 1 || cursor.Resource != resource || cursor.Fingerprint != fingerprint {
		return pageCursor{}, errors.New("invalid page_cursor")
	}
	return cursor, nil
}

func normalizePageSize(size int) int {
	if size <= 0 {
		return defaultPageSize
	}
	if size > maxPageSize {
		return maxPageSize
	}
	return size
}
