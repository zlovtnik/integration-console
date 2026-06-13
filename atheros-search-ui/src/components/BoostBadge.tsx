const BOOST_META: Record<
  string,
  { label: string; tone: string; description: string }
> = {
  near_duplicate: {
    label: 'Duplicate',
    tone: 'warn',
    description: 'A very similar event was seen recently',
  },
  near_duplicate_cluster: {
    label: 'Duplicate cluster',
    tone: 'warn',
    description: 'Result belongs to a near-duplicate event cluster',
  },
  behaviour_anomaly: {
    label: 'Behaviour',
    tone: 'danger',
    description: 'Behavioural profile deviates from the learned baseline',
  },
  new_device: {
    label: 'New device',
    tone: 'warn',
    description: 'Device has not been observed in the known identity set',
  },
  device_fingerprint_change: {
    label: 'Fingerprint',
    tone: 'warn',
    description: 'Device fingerprint changed from its recent baseline',
  },
  open_shadow_alert: {
    label: 'Shadow alert',
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
  embedding_drift: {
    label: 'Embedding drift',
    tone: 'warn',
    description: 'Embedding shifted away from the previous device profile',
  },
  dns_privacy_leak: {
    label: 'DNS leak',
    tone: 'warn',
    description: 'Resolver activity indicates possible DNS policy leakage',
  },
  high_risk_ap: {
    label: 'High-risk AP',
    tone: 'danger',
    description: 'Access point is ranked as high risk',
  },
  rogue_cluster: {
    label: 'Rogue cluster',
    tone: 'danger',
    description: 'Result is associated with a rogue infrastructure cluster',
  },
  deauth_precursor: {
    label: 'Deauth precursor',
    tone: 'warn',
    description: 'Sequence resembles activity preceding deauthentication',
  },
  zero_trust_overlay_risk: {
    label: 'Overlay risk',
    tone: 'warn',
    description: 'Overlay or WireGuard policy signals increased risk',
  },
  rf_impossible_travel: {
    label: 'RF travel',
    tone: 'danger',
    description: 'RF observations imply impossible device movement',
  },
  rogue_rf_path: {
    label: 'RF path',
    tone: 'danger',
    description: 'RF path is associated with rogue infrastructure',
  },
};

const warnedReasons = new Set<string>();

function fallbackLabel(reason: string) {
  return reason.replace(/_/g, ' ');
}

export function BoostBadge(props: { reason: string }) {
  const meta = () => {
    const known = BOOST_META[props.reason];
    if (known) return known;

    if (import.meta.env.DEV && !warnedReasons.has(props.reason)) {
      warnedReasons.add(props.reason);
      console.warn(`Unmapped boost reason: ${props.reason}`);
    }

    return {
      label: fallbackLabel(props.reason),
      tone: 'neutral',
      description: `Boost reason: ${fallbackLabel(props.reason)}`,
    };
  };

  return (
    <span class={`badge badge--${meta().tone}`} title={meta().description}>
      {meta().label}
    </span>
  );
}
