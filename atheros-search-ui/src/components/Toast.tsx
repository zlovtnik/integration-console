import { Show } from 'solid-js';

export function Toast(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      <div class="toast" role="status">
        {props.message}
      </div>
    </Show>
  );
}
