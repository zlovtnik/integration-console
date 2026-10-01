package reportmeta

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestReportConversionRejectsUnserializableScope(t *testing.T) {
	_, err := Proto(New(make(chan int), "entity", "rows", "observations", 0, nil))
	require.Error(t, err)
}
