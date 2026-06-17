export function formatDate(value: string | undefined): string {
  if (!value) return 'n/a';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export function formatValue(
  value: string | number | boolean | undefined,
): string {
  if (value === undefined || value === '') return 'n/a';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

export function DetailRow(props: {
  label: string;
  value?: string | number | boolean | undefined;
  date?: boolean;
}) {
  return (
    <div class="graph-detail-row">
      <dt>{props.label}</dt>
      <dd>
        {props.date
          ? formatDate(String(props.value ?? ''))
          : formatValue(props.value)}
      </dd>
    </div>
  );
}
