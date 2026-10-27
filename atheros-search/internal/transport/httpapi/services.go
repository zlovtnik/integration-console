package httpapi

import (
	"context"
	"net/http"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/assets"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/dedup"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/operations"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/reporting"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/savedviews"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
)

type SearchService interface {
	Search(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error)
	ExplainDetails(context.Context, *searchv1.ExplainRequest) (*search.ExplainDetails, error)
	ExplainScoped(context.Context, search.ScopedExplainRequest) (*search.ExplainDetails, error)
	RecordContext(context.Context, search.RecordContextRequest) (*search.RecordContext, error)
	SuggestFilters(context.Context, *searchv1.SuggestFiltersRequest) (*searchv1.SuggestFiltersResponse, error)
}

type ReportingService interface {
	Graph(context.Context, reporting.GraphFilters) (*reporting.GraphResponse, error)
	Inventory(context.Context, reporting.InventoryFilters) (*reporting.InventoryResponse, error)
	Network(context.Context, reporting.NetworkFilters) (*reporting.NetworkResponse, error)
	Investigation(context.Context, reporting.InvestigationRequest) (*reporting.InvestigationResponse, error)
	Evidence(context.Context, reporting.InvestigationRequest) (*reporting.InvestigationResponse, error)
	PairDetail(context.Context, string) (*reporting.PairDetail, error)
}

type AssetService interface {
	Entities(context.Context, string, string, string, int) (*assets.EntitiesResponse, error)
	AssetAnnotation(context.Context, string, string) (*assets.AssetAnnotation, error)
	UpdateAssetAnnotation(context.Context, string, string, assets.AssetAnnotationUpdate, string) (*assets.AssetAnnotation, error)
	MergeDecision(context.Context, string, string, string) (*assets.MergeDecisionResponse, error)
}

type SavedViewService interface {
	ListSavedViews(context.Context, string, string) ([]savedviews.SavedGraphView, error)
	CreateSavedView(context.Context, string, savedviews.SavedViewCreate) (*savedviews.SavedGraphView, error)
	UpdateSavedView(context.Context, string, string, savedviews.SavedViewUpdate) (*savedviews.SavedGraphView, error)
	DeleteSavedView(context.Context, string, string) error
}

type DedupService interface {
	Admit(context.Context, dedup.Request) (*dedup.Run, error)
	Run(context.Context, string) (*dedup.Run, error)
}

type DQService interface {
	UIContext() dedup.UIContext
	Catalog(context.Context) (*dedup.Catalog, error)
	Version(context.Context, string, string) (*dedup.Manifest, error)
	AdmitProcessor(context.Context, dedup.Admission) (*dedup.WorkspaceRun, error)
	Inspect(context.Context, string) (*dedup.WorkspaceRun, error)
	Cancel(context.Context, string) (*dedup.WorkspaceRun, error)
	Replay(context.Context, string, string) (*dedup.WorkspaceRun, error)
	Artifact(context.Context, string) (*dedup.Artifact, error)
	Access(context.Context, string) (*dedup.ArtifactAccess, error)
	ServeAssets(http.ResponseWriter, *http.Request)
}

type Services struct {
	Search     SearchService
	Reporting  ReportingService
	Assets     AssetService
	SavedViews SavedViewService
	Dedup      DedupService
	DQ         DQService
	Operations OperationsService
}

type OperationsService interface {
	Pipeline(context.Context) operations.Pipeline
	Sources(context.Context) operations.Sources
	ProxyLive(context.Context) operations.ProxyLive
}
