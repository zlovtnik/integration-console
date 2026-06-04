const BOOST_META: Record<
  string,
  { label: string; tone: string; description: string }
> = {
  near_duplicate: {
    label: 'Duplicate',
    tone: 'warn',
    description: 'A very similar event was seen recently',
  },
  open_shadow_alert: {
    label: 'Shadow AP',
    tone: 'danger',
    description: 'Matches a known rogue access point signature',
  },
  payload_risk_score: {
    label: 'Risk payload',
    tone: 'warn',
    description: 'Frame payload contains high-risk indicators',
  },
  ap_composite_risk: {
    label: 'AP risk',
    tone: 'danger',
    description: 'Access point has a composite risk score above threshold',
  },
  threat_tags: {
    label: 'Tagged threat',
    tone: 'danger',
    description: 'Result has one or more threat classification tags',
  },
};

export function BoostBadge(props: { reason: string }) {
  const meta = () =>
    BOOST_META[props.reason] ?? {
      label: props.reason,
      tone: 'neutral',
      description: `Boost reason: ${props.reason}`,
    };

  return (
    <span class={`badge badge--${meta().tone}`} title={meta().description}>
      {meta().label}
    </span>
  );
}
