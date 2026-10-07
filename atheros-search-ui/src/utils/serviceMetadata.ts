type ServiceDomain = {
  label: string;
  domains: readonly string[];
};

const SERVICES: readonly ServiceDomain[] = [
  {
    label: 'Google',
    domains: [
      'google.com',
      'google.co.uk',
      'googleapis.com',
      'gstatic.com',
      'googleusercontent.com',
      'googlevideo.com',
      'gvt1.com',
    ],
  },
  { label: 'Facebook', domains: ['facebook.com', 'fbcdn.net', 'fbsbx.com'] },
  {
    label: 'Instagram',
    domains: ['instagram.com', 'cdninstagram.com', 'instagramstatic.com'],
  },
  { label: 'X / Twitter', domains: ['x.com', 'twitter.com', 'twimg.com'] },
  { label: 'LinkedIn', domains: ['linkedin.com', 'licdn.com'] },
  { label: 'WhatsApp', domains: ['whatsapp.com', 'whatsapp.net'] },
  { label: 'Upwork', domains: ['upwork.com', 'upworkstatic.com'] },
];

/** Returns a recognizable service for known hostnames without loose substring matches. */
export function serviceForHost(host: string): string | undefined {
  const normalized = host.trim().toLowerCase().replace(/\.+$/, '');
  if (!normalized) return undefined;

  return SERVICES.find(({ domains }) =>
    domains.some(
      (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
    ),
  )?.label;
}
