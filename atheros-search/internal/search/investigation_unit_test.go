package search

import "testing"

func TestQualifiesRFOverlap(t *testing.T) {
	tests := []struct {
		sensors, windows int
		want             bool
	}{
		{1, 1, false},
		{2, 1, false},
		{1, 2, false},
		{2, 2, true},
		{3, 3, true},
		{0, 0, false},
		{0, 5, false},
		{5, 0, false},
	}
	for _, tc := range tests {
		tc := tc
		if got := qualifiesRFOverlap(tc.sensors, tc.windows); got != tc.want {
			t.Errorf("qualifiesRFOverlap(%d, %d) = %v, want %v", tc.sensors, tc.windows, got, tc.want)
		}
	}
}

func TestNodeIdentifiersSplitsAnchorSet(t *testing.T) {
	devices, _ := nodeIdentifiers([]GraphNode{
		{ID: "device:aa:bb:cc:dd:ee:ff", Kind: "device", MAC: "aa:bb:cc:dd:ee:ff"},
		{ID: "device:11:22:33:44:55:66", Kind: "device", MAC: "11:22:33:44:55:66"},
	})
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d", len(devices))
	}
	if devices[0] != "aa:bb:cc:dd:ee:ff" || devices[1] != "11:22:33:44:55:66" {
		t.Fatalf("unexpected device order: %v", devices)
	}
}

func TestNodeIdentifiersMixedDeviceAP(t *testing.T) {
	devices2, aps2 := nodeIdentifiers([]GraphNode{
		{ID: "device:aa:bb:cc:dd:ee:ff", Kind: "device", MAC: "aa:bb:cc:dd:ee:ff"},
		{ID: "ap:11:22:33:44:55:66", Kind: "ap", BSSID: "11:22:33:44:55:66"},
	})
	if len(devices2) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices2))
	}
	if devices2[0] != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("unexpected device: %v", devices2)
	}
	if len(aps2) != 1 {
		t.Fatalf("expected 1 AP, got %d", len(aps2))
	}
	if aps2[0] != "11:22:33:44:55:66" {
		t.Fatalf("unexpected AP: %v", aps2)
	}
}

func TestNodeIdentifiersEmptySet(t *testing.T) {
	devices, err := nodeIdentifiers(nil)
	if err != nil {
		t.Fatalf("unexpected error with nil input: %v", err)
	}
	if len(devices) != 0 {
		t.Fatalf("expected 0 devices, got %d: %v", len(devices), devices)
	}
}

func TestNodeIdentifiersSingleNode(t *testing.T) {
	devices, _ := nodeIdentifiers([]GraphNode{
		{ID: "device:aa:bb:cc:dd:ee:ff", Kind: "device", MAC: "aa:bb:cc:dd:ee:ff"},
	})
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}
	if devices[0] != "aa:bb:cc:dd:ee:ff" {
		t.Fatalf("unexpected device: %v", devices)
	}
}
