package worker

import (
	"testing"
)

func TestGroupJobsByKindKeepsEveryJob(t *testing.T) {
	jobs := []Job{{JobID: "1", EmbeddingKind: "event"}, {JobID: "2", EmbeddingKind: "device"}, {JobID: "3", EmbeddingKind: "behaviour"}, {JobID: "4", EmbeddingKind: "sequence"}, {JobID: "5", EmbeddingKind: "event"}}
	grouped := groupJobsByKind(jobs)
	if len(grouped["event"]) != 2 || len(grouped["device"]) != 1 || len(grouped["behaviour"]) != 1 || len(grouped["sequence"]) != 1 {
		t.Fatalf("unexpected groups: %#v", grouped)
	}
}

func TestNormalizeEmbeddingKindSupportsAllWorkerKinds(t *testing.T) {
	for _, kind := range []string{"event", "device", "behaviour", "sequence"} {
		got, err := normalizeEmbeddingKind(kind)
		if err != nil || got != kind {
			t.Fatalf("normalizeEmbeddingKind(%q) = %q, %v", kind, got, err)
		}
	}
}

func TestRemainingJobsStartsAtCurrentGroup(t *testing.T) {
	groups := []jobGroup{
		{kind: "event", jobs: []Job{{JobID: "1"}}},
		{kind: "device", jobs: []Job{{JobID: "2"}, {JobID: "3"}}},
		{kind: "sequence", jobs: []Job{{JobID: "4"}}},
	}
	remaining := remainingJobs(groups[1:])
	if len(remaining) != 3 || remaining[0].JobID != "2" || remaining[2].JobID != "4" {
		t.Fatalf("remaining jobs = %#v", remaining)
	}
}
