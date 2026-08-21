interface IconProps {
  size?: number;
  className?: string;
}

function Svg({
  size = 16,
  className,
  children,
}: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const IconOverview = (p: IconProps) => (
  <Svg {...p}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </Svg>
);

export const IconAgents = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 20 7v10l-8 4-8-4V7l8-4Z" />
    <path d="m4 7 8 4 8-4M12 11v10" />
  </Svg>
);

export const IconExecutions = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />
  </Svg>
);

export const IconApprovals = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 20 6v6c0 4.2-3.2 7.6-8 9-4.8-1.4-8-4.8-8-9V6l8-3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);

export const IconPlans = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 3h8l4 4v14H6V3Z" />
    <path d="M14 3v4h4M9.5 13h5M9.5 16.5h3" />
  </Svg>
);

export const IconAudit = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 6h9M4 12h9M4 18h6" />
    <path d="m15.5 16.5 2 2 4-4" />
  </Svg>
);

export const IconPolicies = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4v16M5 8h14" />
    <path d="M5 8 2.5 14h5L5 8ZM19 8l-2.5 6h5L19 8Z" />
  </Svg>
);

export const IconIntegrations = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7V4M15 7V4M7 7h10v5a5 5 0 0 1-10 0V7ZM12 17v3" />
  </Svg>
);

export const IconArchitecture = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
    <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
  </Svg>
);

export const IconSettings = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7.5 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3.6 14H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 7.5l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.5 1.4l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0 1.1 2.7H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z" />
  </Svg>
);

export const IconSun = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 13}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const IconMoon = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 13}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </Svg>
);

export const IconSystem = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 13}>
    <rect x="2.5" y="4" width="19" height="12.5" rx="2" />
    <path d="M9 20h6M12 16.5V20" />
  </Svg>
);

export const IconPlay = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="M7 4.5v15l12-7.5-12-7.5Z" />
  </Svg>
);

export const IconRefresh = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="M3 12a9 9 0 0 1 15.3-6.4L21 8M21 4v4h-4" />
    <path d="M21 12a9 9 0 0 1-15.3 6.4L3 16M3 20v-4h4" />
  </Svg>
);

export const IconAlert = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 4.5 21 19.5H3L12 4.5Z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="M5 5l14 14M19 5 5 19" />
  </Svg>
);

export const IconChevron = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="m9 5 7 7-7 7" />
  </Svg>
);

export const IconArrowLeft = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </Svg>
);

export const IconShieldStop = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 3 20 6v6c0 4.2-3.2 7.6-8 9-4.8-1.4-8-4.8-8-9V6l8-3Z" />
    <path d="M9 12h6" />
  </Svg>
);

export const IconLock = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
);

export const IconDocument = (p: IconProps) => (
  <Svg {...p} size={p.size ?? 14}>
    <path d="M6 3h8l4 4v14H6V3ZM14 3v4h4" />
  </Svg>
);

export const IconSdk = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 7 4 12l5 5" />
    <path d="m15 7 5 5-5 5" />
  </Svg>
);

export const IconKey = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="8" cy="12" r="4" />
    <path d="M12 12h9" />
    <path d="M17.5 12v3.5" />
    <path d="M20.5 12v2.5" />
  </Svg>
);
