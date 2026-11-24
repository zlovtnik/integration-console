package observability

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"
)

func TestInitTracingDisabled(t *testing.T) {
	previousProvider := otel.GetTracerProvider()
	previousPropagator := otel.GetTextMapPropagator()
	t.Cleanup(func() {
		otel.SetTracerProvider(previousProvider)
		otel.SetTextMapPropagator(previousPropagator)
	})
	t.Setenv("OTEL_TRACES_SAMPLER", "always_on")
	for _, value := range []string{"true", "TRUE", "True"} {
		t.Run(value, func(t *testing.T) {
			t.Setenv("OTEL_SDK_DISABLED", value)
			provider, err := InitTracing(context.Background(), "atheros-search")
			require.NoError(t, err)
			parent := otel.GetTextMapPropagator().Extract(context.Background(), propagation.MapCarrier{
				"traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
			})
			require.True(t, trace.SpanContextFromContext(parent).IsSampled())
			_, span := provider.Tracer("test").Start(parent, "search")
			require.False(t, span.IsRecording())
			span.End()
			require.NoError(t, provider.ForceFlush(context.Background()))
			require.NoError(t, provider.Shutdown(context.Background()))
		})
	}
}

func TestTracerProviderExportsSpanWithServiceName(t *testing.T) {
	exporter := tracetest.NewInMemoryExporter()
	provider := NewTracerProvider("atheros-search", exporter)
	t.Cleanup(func() {
		require.NoError(t, provider.Shutdown(context.Background()))
	})

	_, span := provider.Tracer("test").Start(context.Background(), "search")
	span.End()
	require.NoError(t, provider.ForceFlush(context.Background()))

	spans := exporter.GetSpans()
	require.Len(t, spans, 1)
	value, found := spans[0].Resource.Set().Value("service.name")
	require.True(t, found)
	require.Equal(t, "atheros-search", value.AsString())
}
