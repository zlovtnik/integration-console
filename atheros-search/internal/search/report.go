package search

import (
	"encoding/json"
	"google.golang.org/protobuf/types/known/structpb"
	"time"
)

// Watermarks remain unavailable until the service has a verified source and
// projection freshness contract. Response generation is not such a watermark.
type ReportMetadata struct {
	Scope                   any        `json:"scope"`
	EntityGrain             string     `json:"entity_grain"`
	CountMeaning            string     `json:"count_meaning"`
	ObservationStart        *time.Time `json:"observation_start,omitempty"`
	ObservationEnd          *time.Time `json:"observation_end,omitempty"`
	ObservationBasis        string     `json:"observation_basis"`
	Freshness               string     `json:"freshness"`
	SourceWatermark         *time.Time `json:"source_watermark,omitempty"`
	ProjectionWatermark     *time.Time `json:"projection_watermark,omitempty"`
	LoadedRows              int        `json:"loaded_rows"`
	TotalRows               *int       `json:"total_rows,omitempty"`
	IncompleteCoverage      bool       `json:"incomplete_coverage"`
	UnavailableCapabilities []string   `json:"unavailable_capabilities"`
	Live                    bool       `json:"live"`
}

func reportMetadata(scope any, grain, meaning, basis string, loaded int, total *int) *ReportMetadata {
	return &ReportMetadata{Scope: scope, EntityGrain: grain, CountMeaning: meaning, ObservationBasis: basis,
		Freshness: "unavailable", LoadedRows: loaded, TotalRows: total, IncompleteCoverage: true,
		UnavailableCapabilities: []string{"source_watermark", "projection_watermark", "sensor_coverage"}, Live: true}
}

func reportStruct(report *ReportMetadata) *structpb.Struct {
	raw, err := json.Marshal(report)
	if err != nil {
		return nil
	}
	var value map[string]any
	if json.Unmarshal(raw, &value) != nil {
		return nil
	}
	result, _ := structpb.NewStruct(value)
	return result
}
