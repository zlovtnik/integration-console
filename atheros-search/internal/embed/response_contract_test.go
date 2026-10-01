package embed

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEmbeddingBackendRequestAndResponseContracts(t *testing.T) {
	for _,tc:=range []struct{name,body string; status int; invalid bool}{
		{"openai",`{"data":[{"embedding":[1,2]},{"embedding":[3,4]}]}`,200,false},
		{"embeddings",`{"embeddings":[[1,2],[3,4]]}`,200,false},
		{"count",`{"embeddings":[[1,2]]}`,200,true},
		{"dimensions",`{"embeddings":[[1],[3,4]]}`,200,true},
		{"malformed",`{`,200,true},
		{"nonfinite",`{"embeddings":[[1e100,2],[3,4]]}`,200,true},
		{"capacity",`{"error":"capacity exhausted"}`,429,true},
	} {
		t.Run(tc.name,func(t *testing.T){
			server:=httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter,r *http.Request){
				require.Equal(t,"/v1/embeddings",r.URL.Path)
				require.Equal(t,http.MethodPost,r.Method)
				require.Equal(t,"application/json",r.Header.Get("Content-Type"))
				var request embeddingsRequest
				require.NoError(t,json.NewDecoder(r.Body).Decode(&request))
				require.Equal(t,"contract-model",request.Model)
				require.Equal(t,[]string{"first","second"},request.Input)
				w.WriteHeader(tc.status)
				_,err:=w.Write([]byte(tc.body));require.NoError(t,err)
			}))
			defer server.Close()
			client:=&HTTPClient{BaseURL:server.URL,Model:"contract-model",Dimensions:2,Client:server.Client()}
			vectors,err:=client.embedOnce(t.Context(),[]string{"first","second"})
			if tc.invalid {
				var unavailable *BackendUnavailableError
				require.ErrorAs(t,err,&unavailable)
				if tc.status==200 {require.ErrorIs(t,err,ErrInvalidResponse)}
			} else {
				require.NoError(t,err)
				require.Equal(t,[][]float32{{1,2},{3,4}},vectors)
			}
		})
	}
}
