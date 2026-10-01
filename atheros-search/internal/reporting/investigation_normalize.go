package reporting

import (
	"strings"
	"time"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/queryscope"
)

func NormalizeInvestigationRequest(request InvestigationRequest) (InvestigationRequest, error) {
	request.Anchor.Kind = strings.ToLower(strings.TrimSpace(request.Anchor.Kind))
	request.Anchor.ID = strings.ToLower(strings.TrimSpace(request.Anchor.ID))
	request.APBSSID = strings.ToLower(strings.TrimSpace(request.APBSSID))
	request.DeviceMAC = strings.ToLower(strings.TrimSpace(request.DeviceMAC))
	if request.Anchor.Kind != "" {
		if request.Anchor.Kind != "ap" && request.Anchor.Kind != "device" {
			return request, apperror.Validationf("investigation anchor kind must be ap or device")
		}
		if !queryscope.MacPattern.MatchString(request.Anchor.ID) {
			return request, apperror.Validationf("investigation anchor id must be a MAC address")
		}
		if request.Anchor.Kind == "ap" {
			request.APBSSID = request.Anchor.ID
		} else {
			request.DeviceMAC = request.Anchor.ID
		}
	}
	if request.APBSSID != "" && !queryscope.MacPattern.MatchString(request.APBSSID) {
		return request, apperror.Validationf("invalid AP BSSID")
	}
	if request.DeviceMAC != "" && !queryscope.MacPattern.MatchString(request.DeviceMAC) {
		return request, apperror.Validationf("invalid device MAC")
	}
	if request.APBSSID != "" && request.DeviceMAC != "" {
		return request, apperror.Validationf("investigation accepts one focused anchor")
	}
	if request.Anchor.Kind == "" {
		if request.APBSSID != "" {
			request.Anchor = InvestigationAnchor{Kind: "ap", ID: request.APBSSID}
		}
		if request.DeviceMAC != "" {
			request.Anchor = InvestigationAnchor{Kind: "device", ID: request.DeviceMAC}
		}
	}
	if request.ObservedBefore == nil {
		now := time.Now().UTC()
		request.ObservedBefore = &now
	}
	if request.ObservedAfter == nil {
		start := request.ObservedBefore.Add(-24 * time.Hour)
		request.ObservedAfter = &start
	}
	if !request.ObservedAfter.Before(*request.ObservedBefore) {
		return request, apperror.Validationf("observed_after must be before observed_before")
	}
	request.LocationIDs = queryscope.NormalizeGraphList(request.LocationIDs)
	request.SensorIDs = queryscope.NormalizeGraphList(request.SensorIDs)
	if request.NodeLimit <= 0 {
		request.NodeLimit = InvestigationDefaultNodes
	}
	if request.NodeLimit > InvestigationDefaultNodes {
		request.NodeLimit = InvestigationDefaultNodes
	}
	if request.EdgeLimit <= 0 {
		request.EdgeLimit = InvestigationDefaultEdges
	}
	if request.EdgeLimit > InvestigationDefaultEdges {
		request.EdgeLimit = InvestigationDefaultEdges
	}
	if request.EvidenceSize <= 0 {
		request.EvidenceSize = InvestigationDefaultRows
	}
	if request.EvidenceSize > InvestigationDefaultRows {
		request.EvidenceSize = InvestigationDefaultRows
	}
	if request.EvidencePage < 0 {
		return request, apperror.Validationf("evidence_page must not be negative")
	}
	return request, nil
}
