// 轻量线性图标（1:1 搬自 Easel web/frontend/src/components/icons.tsx，Apache-2.0；Lucide 风格，stroke=currentColor）
"use client";

interface P {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const svg = (size = 18, sw = 1.8) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: sw,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const IconNewChat = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" />
  </svg>
);
export const IconArrowUp = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M12 19V5" />
    <path d="m5 12 7-7 7 7" />
  </svg>
);
export const IconStop = ({ size, className }: P) => (
  <svg {...svg(size)} className={className} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
);
export const IconCopy = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
export const IconCheck = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
export const IconEdit = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
export const IconTrash = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);
export const IconSearch = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </svg>
);
export const IconX = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

export const IconRefresh = ({ size, className, strokeWidth }: P) => (
  <svg {...svg(size, strokeWidth)} className={className}>
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);
