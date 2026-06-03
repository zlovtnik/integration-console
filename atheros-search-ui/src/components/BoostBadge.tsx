const BOOST_META: Record<string, { label: string; tone: string }> = {
  near_duplicate: { label: 'near duplicate', tone: 'warn' },
  open_shadow_alert: { label: 'shadow alert', tone: 'danger' },
  payload_risk_score: { label: 'risk score', tone: 'warn' },
  ap_composite_risk: { label: 'AP risk', tone: 'danger' },
  threat_tags: { label: 'threat tags', tone: 'danger' },
};

export function BoostBadge(props: { reason: string }) {
  const meta = () => BOOST_META[props.reason] ?? { label: props.reason, tone: 'neutral' };
  return (
    <span class={`badge badge--${meta().tone}`} title={`Boost reason: ${meta().label}`}>
      {meta().label}
    </span>
  );
}
