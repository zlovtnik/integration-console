import { For, Show } from 'solid-js';
import type { ActivityBucket, ActivityTotals } from '~/api/types';

const CHART_BUCKETS = 96;

function shortTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function windowLabel(start: string, end: string | undefined): string {
  return end ? `${shortTime(start)} to ${shortTime(end)}` : shortTime(start);
}

/**
 * Observed traffic rate over time. The bars are the fast read; the table is the
 * accessible equivalent and carries the same numbers, because a chart alone is
 * not usable with a screen reader.
 */
export function ActivityTimeline(props: {
  activity: ActivityBucket[];
  totals: ActivityTotals;
  bucketMinutes: number;
}) {
  // A wide window collapses into many empty leading buckets once downsampled for
  // display. Summing per drawn column keeps the visual total honest.
  const columns = () => {
    const source = props.activity;
    if (source.length === 0) return [];
    const size = Math.max(1, Math.ceil(source.length / CHART_BUCKETS));
    const grouped: { start: string; end?: string; frames: number; rate: number }[] = [];
    for (let index = 0; index < source.length; index += size) {
      const slice = source.slice(index, index + size);
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (!first || !last) continue;
      const frames = slice.reduce((sum, item) => sum + item.frame_count, 0);
      const minutes = slice.length * props.bucketMinutes;
      grouped.push({
        start: first.window_start,
        end: last.window_start,
        frames,
        rate: minutes > 0 ? Math.round((frames / minutes) * 100) / 100 : 0,
      });
    }
    return grouped;
  };

  const peak = () =>
    Math.max(props.totals.peak_frames_per_minute, 1) || 1;

  return (
    <div class="explain-activity">
      <div class="explain-activity-totals">
        <span>
          <strong>{props.totals.frame_count}</strong> frames
        </span>
        <span>
          <strong>{props.totals.frames_per_minute}</strong> frames/min
        </span>
        <span>
          peak <strong>{props.totals.peak_frames_per_minute}</strong> frames/min
        </span>
        <span>
          <strong>{props.totals.sensor_count}</strong> sensors
        </span>
        <span>
          <strong>{props.totals.ap_count}</strong> APs
        </span>
        <span>
          <strong>{props.totals.buckets}</strong> {props.bucketMinutes}-min buckets
        </span>
      </div>
      <Show
        when={props.activity.length > 0}
        fallback={
          <p class="graph-panel-empty" role="status">
            No retained frame summaries fall in this window. A partial or
            stalled projection does not establish that nothing was observed.
          </p>
        }
      >
        <div
          class="explain-activity-chart"
          role="img"
          aria-label={`Observed traffic rate across ${props.activity.length} ${props.bucketMinutes}-minute buckets. Peak ${props.totals.peak_frames_per_minute} frames per minute.`}
        >
          <For each={columns()}>
            {(column) => (
              <div
                class="explain-activity-bar"
                style={{ height: `${Math.max(2, (column.rate / peak()) * 100)}%` }}
                title={`${windowLabel(column.start, column.end)}: ${column.frames} frames, ${column.rate} per minute`}
              />
            )}
          </For>
        </div>
        <table class="explain-activity-table">
          <caption class="sr-only">
            Observed traffic per {props.bucketMinutes}-minute bucket
          </caption>
          <thead>
            <tr>
              <th scope="col">Window</th>
              <th scope="col">Frames</th>
              <th scope="col">Frames/min</th>
              <th scope="col">Sensors</th>
              <th scope="col">APs</th>
            </tr>
          </thead>
          <tbody>
            <For each={columns()}>
              {(column, index) => {
                const source = () => {
                  const size = Math.max(
                    1,
                    Math.ceil(props.activity.length / CHART_BUCKETS),
                  );
                  return props.activity.slice(
                    index() * size,
                    index() * size + size,
                  );
                };
                return (
                  <tr>
                    <td>{windowLabel(column.start, column.end)}</td>
                    <td>{column.frames}</td>
                    <td>{column.rate}</td>
                    <td>
                      {Math.max(...source().map((item) => item.sensor_count))}
                    </td>
                    <td>
                      {Math.max(...source().map((item) => item.ap_count))}
                    </td>
                  </tr>
                );
              }}
            </For>
          </tbody>
        </table>
      </Show>
    </div>
  );
}
