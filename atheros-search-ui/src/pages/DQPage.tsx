import { A, useLocation, useNavigate } from '@solidjs/router';
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { auditGeneration } from '~/auth/auditState';
import { fetchDQ, hostBridge, type UIContext } from '~/dq/bridge';
import { ReviewWorkspace } from '~/components/inventory/ReviewWorkspace';
import { loadDedupQueue, cancelDedupQueue } from '~/hooks/useInventory';
import '~/styles/inventory.css';
import '~/styles/reports.css';

export default function DQPage() {
  const location = useLocation();
  const navigate = useNavigate();
  let contextController: AbortController | undefined;
  const [context, { refetch }] = createResource(auditGeneration, async () => {
    contextController?.abort();
    contextController = new AbortController();
    const timer = window.setTimeout(() => contextController?.abort(), 10000);
    try {
      return {
        value: (await fetchDQ(
          { path: '/v1/dq/context', method: 'GET' },
          contextController.signal,
        )) as UIContext,
      };
    } catch {
      return {
        error: 'DQ is unavailable. Existing Atheros pages remain available.',
      };
    } finally {
      window.clearTimeout(timer);
    }
  });
  const review = () =>
    location.pathname === '/dq' || location.pathname === '/dq/';
  const [revision, setRevision] = createSignal(0);
  onCleanup(() => {
    contextController?.abort();
    cancelDedupQueue();
  });
  return (
    <main id="main-content" class="inventory-page" tabIndex={-1}>
      <h1>DQ workspace</h1>
      <nav aria-label="DQ navigation">
        <A href={'/dq' + location.search}>Review candidates</A>
        {' / '}
        <A href={'/dq/atheros/dedup' + location.search}>Prepare candidates</A>
        {' / '}
        <A href={'/dq/processors' + location.search}>Processors</A>
      </nav>
      <Show when={context.loading}>
        <p role="status">Loading DQ settings...</p>
      </Show>
      <Show when={context()?.error}>
        <p role="alert">
          {context()?.error}{' '}
          <button onClick={() => void refetch()}>Retry</button>
        </p>
      </Show>
      <Show when={context()?.value && !context()?.value?.enabled}>
        <p role="status">
          DQ is disabled.{' '}
          <A href={'/inventory' + location.search}>Open Inventory review</A>
        </p>
      </Show>
      <Show
        when={
          context()?.value?.enabled && context()?.value?.bridge_version !== 1
        }
      >
        <p role="alert">
          DQ workspace version is unavailable.{' '}
          <button onClick={() => void refetch()}>Retry</button>
        </p>
      </Show>
      <Show
        when={
          context()?.value?.enabled && context()?.value?.bridge_version === 1
        }
      >
        <Show
          when={review()}
          fallback={
            <DQFrame
              path={location.pathname}
              navigate={(path) => navigate(path + location.search)}
              projection={() => {
                setRevision((v) => v + 1);
                void loadDedupQueue();
              }}
            />
          }
        >
          <ReviewWorkspace revision={revision()} />
        </Show>
      </Show>
    </main>
  );
}

function DQFrame(props: {
  path: string;
  navigate: (path: string) => void;
  projection: () => void;
}) {
  let frame: HTMLIFrameElement | undefined;
  const [attempt, setAttempt] = createSignal(0);
  const [ready, setReady] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [src, setSrc] = createSignal('');
  let bridge: ReturnType<typeof hostBridge> | undefined;
  createEffect(() => {
    attempt();
    auditGeneration();
    setReady(false);
    setFailed(false);
    let handshakeComplete = false;
    const channel = crypto.randomUUID();
    bridge = hostBridge({
      frame: () => frame?.contentWindow ?? null,
      channel,
      origin: window.location.origin,
      navigate: props.navigate,
      ready: () => {
        handshakeComplete = true;
        setReady(true);
      },
      projection: props.projection,
    });
    const active = bridge;
    const timer = window.setTimeout(() => {
      if (!handshakeComplete) {
        setFailed(true);
        setSrc('');
        active.dispose();
      }
    }, 10000);
    window.addEventListener('message', active.receive);
    setSrc('/dq-ui/embedded.html#' + new URLSearchParams({ channel }));
    onCleanup(() => {
      window.clearTimeout(timer);
      window.removeEventListener('message', active.receive);
      active.dispose();
    });
  });
  createEffect(() => {
    if (ready()) bridge?.route(props.path);
  });
  return (
    <section aria-label="DQ application">
      <Show when={!ready() && !failed()}>
        <p role="status">Loading DQ application...</p>
      </Show>
      <Show when={failed()}>
        <p role="alert">
          DQ application is unavailable.{' '}
          <button onClick={() => setAttempt((v) => v + 1)}>Retry DQ</button>
        </p>
      </Show>
      <Show when={src()}>
        <iframe
          title="DQ workspace"
          src={src()}
          ref={frame}
          class="dq-frame"
          onError={() => {
            setFailed(true);
            setSrc('');
            bridge?.dispose();
          }}
        />
      </Show>
    </section>
  );
}
