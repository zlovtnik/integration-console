package grpcapi

import (
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"testing"

	"github.com/stretchr/testify/require"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/apperror"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	searchv1 "github.com/zlovtnik/ssl-proxy/services/atheros-search/proto/atheros/search/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

type stub struct {
	SearchService
	response *searchv1.SearchResponse
	err      error
}

func (s stub) Search(context.Context, *searchv1.SearchRequest) (*searchv1.SearchResponse, error) {
	return s.response, s.err
}

func TestErrorTranslationPreservesTypedStatusAndMessage(t *testing.T) {
	for _, tc := range []struct {
		err  error
		code codes.Code
	}{
		{apperror.Validationf("invalid scope"), codes.InvalidArgument},
		{apperror.New(apperror.ErrNotFound, "missing"), codes.NotFound},
		{apperror.New(apperror.ErrConflict, "stale revision"), codes.Aborted},
		{apperror.New(apperror.ErrForbidden, "forbidden"), codes.PermissionDenied},
		{&apperror.UnavailableError{Message: "semantic backend unavailable"}, codes.Unavailable},
		{context.Canceled, codes.Canceled}, {context.DeadlineExceeded, codes.DeadlineExceeded},
	} {
		err := fmt.Errorf("wrapped: %w", tc.err)
		translated := translateError(err)
		require.Equal(t, tc.code, status.Code(translated))
		require.Equal(t, err.Error(), status.Convert(translated).Message())
	}
}

func TestProtobufUnaryAndStreamingClientContract(t *testing.T) {
	data, err := os.ReadFile("../../../testdata/contracts/search.json")
	require.NoError(t, err)
	var response searchv1.SearchResponse
	require.NoError(t, protojson.Unmarshal(data, &response))
	a, err := auth.NewTokenAuth("")
	require.NoError(t, err)
	lis := bufconn.Listen(1 << 20)
	server := grpc.NewServer(grpc.UnaryInterceptor(unaryAuth(a)), grpc.StreamInterceptor(streamAuth(a)))
	searchv1.RegisterSearchServiceServer(server, &service{search: stub{response: &response}})
	go func() { _ = server.Serve(lis) }() // Serve ends when the test stops the server.
	defer server.Stop()
	conn, err := grpc.NewClient("passthrough:///contract", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return lis.Dial() }))
	require.NoError(t, err)
	defer func() { require.NoError(t, conn.Close()) }()
	client := searchv1.NewSearchServiceClient(conn)
	got, err := client.Search(t.Context(), &searchv1.SearchRequest{})
	require.NoError(t, err)
	require.True(t, proto.Equal(&response, got))
	stream, err := client.SearchStream(t.Context(), &searchv1.SearchRequest{})
	require.NoError(t, err)
	for _, expected := range response.Results {
		got, err := stream.Recv()
		require.NoError(t, err)
		require.True(t, proto.Equal(expected, got))
	}
	_, err = stream.Recv()
	require.ErrorIs(t, err, io.EOF)
}
