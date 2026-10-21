package embed

import (
	"fmt"
	"math"
)

// ValidateVector rejects unusable backend and pooled outputs before cosine
// retrieval or either durable vector store can consume them.
func ValidateVector(vector []float32, dimensions int) error {
	if len(vector) != dimensions {
		return fmt.Errorf("embedding has %d dimensions, expected %d", len(vector), dimensions)
	}
	var norm float64
	for _, value := range vector {
		v := float64(value)
		if math.IsNaN(v) || math.IsInf(v, 0) {
			return fmt.Errorf("embedding contains non-finite values")
		}
		norm += v * v
	}
	if norm == 0 || math.IsInf(norm, 0) || math.IsNaN(norm) {
		return fmt.Errorf("embedding has unusable norm")
	}
	return nil
}
