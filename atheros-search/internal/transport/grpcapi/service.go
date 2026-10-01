package grpcapi

import (
	"context"
	"errors"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/embed"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type SearchService interface {
	Search(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error)
	Explain(context.Context, *searchv1.ExplainRequest) (*searchv1.ExplainResponse, error)
	SuggestFilters(context.Context, *searchv1.SuggestFiltersRequest) (*searchv1.SuggestFiltersResponse, error)
}

type service struct {
	searchv1.UnimplementedSearchServiceServer
	search SearchService
}

func (s *service) Search(ctx context.Context, req *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	resp, err := s.search.Search(ctx, req)
	return resp, translateError(err)
}
func (s *service) Explain(ctx context.Context, req *searchv1.ExplainRequest) (*searchv1.ExplainResponse, error) {
	resp, err := s.search.Explain(ctx, req)
	return resp, translateError(err)
}
func (s *service) SuggestFilters(ctx context.Context, req *searchv1.SuggestFiltersRequest) (*searchv1.SuggestFiltersResponse, error) {
	resp, err := s.search.SuggestFilters(ctx, req)
	return resp, translateError(err)
}
func (s *service) SearchStream(req *searchv1.SearchRequest, stream searchv1.SearchService_SearchStreamServer) error {
	resp, err := s.search.Search(stream.Context(), req)
	if err != nil {
		return translateError(err)
	}
	for _, result := range resp.Results {
		if err := stream.Send(result); err != nil {
			return err
		}
	}
	return nil
}

func translateError(err error) error {
	if err == nil {
		return nil
	}
	code := codes.Unknown
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		code = codes.DeadlineExceeded
	case errors.Is(err, context.Canceled):
		code = codes.Canceled
	case errors.Is(err, apperror.ErrValidation), errors.Is(err, embed.ErrInvalidRequest), errors.Is(err, embed.ErrOversizedInput):
		code = codes.InvalidArgument
	case errors.Is(err, apperror.ErrNotFound):
		code = codes.NotFound
	case errors.Is(err, apperror.ErrConflict):
		code = codes.Aborted
	case errors.Is(err, apperror.ErrForbidden):
		code = codes.PermissionDenied
	case errors.Is(err, apperror.ErrUnavailable):
		code = codes.Unavailable
	}
	return status.Error(code, err.Error())
}
