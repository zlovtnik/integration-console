package api

import (
	"context"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"

	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/auth"
	"github.com/zlovtnik/ssl-proxy/services/atheros-search/internal/search"
)

const savedViewFixtureID = "2f6b6a3a-1f2c-4c8a-9a2b-0f5f9f9f9f9f"

func startSavedViewServer(t *testing.T, tokenAuth *auth.TokenAuth, service *search.Service) *http.Server {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	t.Cleanup(cancel)
	server, err := StartHTTP(ctx, 0, nil, service, nil, tokenAuth, nil, false, zerolog.Nop())
	require.NoError(t, err)
	t.Cleanup(func() { _ = server.Close() })
	return server
}

func TestSavedViewsReportUnavailableWithoutStableIdentity(t *testing.T) {
	t.Run("auth disabled", func(t *testing.T) {
		server := startSavedViewServer(t, nil, &search.Service{})
		request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/saved-views", nil)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusForbidden, response.Code)
		require.JSONEq(t, `{"error":"saved views require a signed-in user"}`, response.Body.String())
	})

	t.Run("static token deployment", func(t *testing.T) {
		sum := sha256.Sum256([]byte("secret-token"))
		tokenAuth, err := auth.NewTokenAuth(hex.EncodeToString(sum[:]))
		require.NoError(t, err)
		server := startSavedViewServer(t, tokenAuth, &search.Service{})

		request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/saved-views", nil)
		request.Header.Set("Authorization", "Bearer secret-token")
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusForbidden, response.Code)
		require.JSONEq(t, `{"error":"saved views require a signed-in user"}`, response.Body.String())
	})
}

func TestSavedViewsRejectMissingToken(t *testing.T) {
	sum := sha256.Sum256([]byte("secret-token"))
	tokenAuth, err := auth.NewTokenAuth(hex.EncodeToString(sum[:]))
	require.NoError(t, err)
	server := startSavedViewServer(t, tokenAuth, &search.Service{})

	request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/saved-views", nil)
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)

	require.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestSavedViewsScopedToImmutableSubject(t *testing.T) {
	tokenAuth, bearer := savedViewJWTAuth(t, "subject-1", "alice")
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	mock.ExpectQuery("ORDER BY lower").
		WithArgs("subject-1", "graph_projection").
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "surface", "view_version", "revision", "state", "created_at", "updated_at"}))

	server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
	request := httptest.NewRequest(http.MethodGet, "https://gateway.rclabs.uk/v1/saved-views?surface=graph_projection", nil)
	request.Header.Set("Authorization", "Bearer "+bearer)
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.JSONEq(t, `{"views":[]}`, response.Body.String())
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSavedViewCreateReturnsCreated(t *testing.T) {
	tokenAuth, bearer := savedViewJWTAuth(t, "subject-1", "alice")
	database, mock, err := sqlmock.New()
	require.NoError(t, err)
	defer database.Close()

	createdAt := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery("count").WithArgs("subject-1", "graph_projection").
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery("LIMIT 1").
		WithArgs("subject-1", "graph_projection", "Nightly", nil).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("INSERT INTO atheros_search.saved_views").
		WithArgs("subject-1", "graph_projection", "Nightly", search.SavedViewVersion, sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"id", "name", "surface", "view_version", "revision", "state", "created_at", "updated_at"}).
			AddRow(savedViewFixtureID, "Nightly", "graph_projection", 1, 1,
				[]byte(`{"filters":{"limit":200}}`), createdAt, createdAt))
	mock.ExpectCommit()

	server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
	body := `{"name":"Nightly","state":{"filters":{"limit":200},"visible_node_kinds":["ap"]}}`
	request := httptest.NewRequest(http.MethodPost, "https://gateway.rclabs.uk/v1/saved-views", strings.NewReader(body))
	request.Header.Set("Authorization", "Bearer "+bearer)
	response := httptest.NewRecorder()
	server.Handler.ServeHTTP(response, request)

	require.Equal(t, http.StatusCreated, response.Code)
	var created map[string]any
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &created))
	require.Equal(t, savedViewFixtureID, created["id"])
	require.Equal(t, "Nightly", created["name"])
	require.Equal(t, "graph_projection", created["surface"])
	require.NotContains(t, created, "owner_subject")
	require.NoError(t, mock.ExpectationsWereMet())
}

func TestSavedViewCreateRejectsInvalidPayload(t *testing.T) {
	tokenAuth, bearer := savedViewJWTAuth(t, "subject-1", "alice")
	server := startSavedViewServer(t, tokenAuth, &search.Service{})

	for _, body := range []string{
		`{"name":"   "}`,
		`{"name":"` + strings.Repeat("a", 81) + `"}`,
		`{"name":"ok","state":{"visible_node_kinds":["not_a_kind"]}}`,
		`{"name":"ok","surface":"other"}`,
	} {
		request := httptest.NewRequest(http.MethodPost, "https://gateway.rclabs.uk/v1/saved-views", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)
		require.Equal(t, http.StatusBadRequest, response.Code, "body %s", body)
	}
}

func TestSavedViewUpdateConflictAndOwnership(t *testing.T) {
	tokenAuth, bearer := savedViewJWTAuth(t, "subject-1", "alice")

	t.Run("stale revision is conflict", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectBegin()
		mock.ExpectQuery("FOR UPDATE").
			WithArgs(savedViewFixtureID, "subject-1").
			WillReturnRows(sqlmock.NewRows([]string{"name", "revision"}).AddRow("Nightly", 3))

		server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
		body := `{"name":"Nightly","state":{"filters":{"limit":200}},"expected_revision":4}`
		request := httptest.NewRequest(http.MethodPut, "https://gateway.rclabs.uk/v1/saved-views/"+savedViewFixtureID, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusConflict, response.Code)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("foreign id is not found", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectBegin()
		mock.ExpectQuery("FOR UPDATE").
			WithArgs(savedViewFixtureID, "subject-1").
			WillReturnError(sql.ErrNoRows)

		server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
		body := `{"name":"Nightly","state":{"filters":{"limit":200}},"expected_revision":1}`
		request := httptest.NewRequest(http.MethodPut, "https://gateway.rclabs.uk/v1/saved-views/"+savedViewFixtureID, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusNotFound, response.Code)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("negative expected revision is invalid", func(t *testing.T) {
		server := startSavedViewServer(t, tokenAuth, &search.Service{})
		body := `{"name":"Nightly","state":{"filters":{"limit":200}},"expected_revision":-1}`
		request := httptest.NewRequest(http.MethodPut, "https://gateway.rclabs.uk/v1/saved-views/"+savedViewFixtureID, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusBadRequest, response.Code)
	})
}

func TestSavedViewDeleteReportsStatusCodes(t *testing.T) {
	tokenAuth, bearer := savedViewJWTAuth(t, "subject-1", "alice")

	t.Run("missing row is 404", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectExec("DELETE FROM atheros_search.saved_views").
			WithArgs(savedViewFixtureID, "subject-1").
			WillReturnResult(sqlmock.NewResult(0, 0))

		server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
		request := httptest.NewRequest(http.MethodDelete, "https://gateway.rclabs.uk/v1/saved-views/"+savedViewFixtureID, nil)
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusNotFound, response.Code)
		require.NoError(t, mock.ExpectationsWereMet())
	})

	t.Run("owned row is 204", func(t *testing.T) {
		database, mock, err := sqlmock.New()
		require.NoError(t, err)
		defer database.Close()

		mock.ExpectExec("DELETE FROM atheros_search.saved_views").
			WithArgs(savedViewFixtureID, "subject-1").
			WillReturnResult(sqlmock.NewResult(0, 1))

		server := startSavedViewServer(t, tokenAuth, &search.Service{Pool: database})
		request := httptest.NewRequest(http.MethodDelete, "https://gateway.rclabs.uk/v1/saved-views/"+savedViewFixtureID, nil)
		request.Header.Set("Authorization", "Bearer "+bearer)
		response := httptest.NewRecorder()
		server.Handler.ServeHTTP(response, request)

		require.Equal(t, http.StatusNoContent, response.Code)
		require.Empty(t, response.Body.String())
		require.NoError(t, mock.ExpectationsWereMet())
	})
}

func TestSavedViewErrorStatusMapping(t *testing.T) {
	require.Equal(t, http.StatusNotFound, httpStatusFromError(search.ErrSavedViewNotFound))
	require.Equal(t, http.StatusConflict, httpStatusFromError(search.ErrSavedViewDuplicateName))
	require.Equal(t, http.StatusConflict, httpStatusFromError(search.ErrSavedViewStaleRevision))
	require.Equal(t, http.StatusConflict, httpStatusFromError(search.ErrSavedViewLimitReached))
	require.Equal(t, http.StatusForbidden, httpStatusFromError(search.ErrSavedViewUnavailable))
	require.Equal(t, http.StatusBadRequest, httpStatusFromError(errors.New("invalid saved view name: must be 1 to 80 characters")))
	require.Equal(t, http.StatusBadRequest, httpStatusFromError(errors.New("invalid saved view state: unsupported node kind \"wat\"")))
	require.Equal(t, http.StatusBadRequest, httpStatusFromError(errors.New("unsupported saved view surface \"other\"")))
}

// savedViewJWTAuth builds a JWT authenticator backed by an ephemeral JWKS
// server and returns a bearer token for the given immutable subject.
func savedViewJWTAuth(t *testing.T, subject, username string) (*auth.TokenAuth, string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	require.NoError(t, err)
	keyID := "key-1"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
			"kty": "RSA", "use": "sig", "kid": keyID,
			"n": base64.RawURLEncoding.EncodeToString(key.N.Bytes()),
			"e": base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.E)).Bytes()),
		}}})
	}))
	t.Cleanup(server.Close)

	issuer := "https://gateway.example.test/realms/middleware"
	tokenAuth, err := auth.NewJWTTokenAuth(auth.JWTConfig{
		Issuer: issuer, JWKSURI: server.URL, Audience: "atheros-search-ui", ClientID: "atheros-search-ui",
	})
	require.NoError(t, err)

	now := time.Now().UTC().Truncate(time.Second)
	claims := map[string]any{
		"iss":                issuer,
		"aud":                []string{"account", "atheros-search-ui"},
		"exp":                now.Add(5 * time.Minute).Unix(),
		"sub":                subject,
		"preferred_username": username,
		"resource_access": map[string]any{
			"atheros-search-ui": map[string]any{"roles": []string{auth.RoleViewer}},
		},
	}
	return tokenAuth, signSavedViewJWT(t, key, keyID, claims)
}

func signSavedViewJWT(t *testing.T, key *rsa.PrivateKey, keyID string, claims map[string]any) string {
	t.Helper()
	header, err := json.Marshal(map[string]string{"alg": "RS256", "kid": keyID, "typ": "JWT"})
	require.NoError(t, err)
	payload, err := json.Marshal(claims)
	require.NoError(t, err)
	unsigned := base64.RawURLEncoding.EncodeToString(header) + "." + base64.RawURLEncoding.EncodeToString(payload)
	digest := sha256.Sum256([]byte(unsigned))
	signature, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, digest[:])
	require.NoError(t, err)
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(signature)
}
