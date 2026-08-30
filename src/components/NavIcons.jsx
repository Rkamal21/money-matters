/**
 * Fintech-style outline icons for bottom nav.
 * Consistent 24px stroke-based set.
 */
const size = 24;
const stroke = 2;
const common = { width: size, height: size, strokeWidth: stroke, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };

export function IconHome({ active, ...props }) {
  return (
    <svg viewBox="0 0 24 24" {...common} {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="currentColor" />
      <path d="M9 22V12h6v10" stroke="currentColor" />
    </svg>
  );
}

export function IconTarget({ active, ...props }) {
  return (
    <svg viewBox="0 0 24 24" {...common} {...props}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" />
      <circle cx="12" cy="12" r="6" stroke="currentColor" />
      <circle cx="12" cy="12" r="2" stroke="currentColor" fill={active ? 'currentColor' : 'none'} />
    </svg>
  );
}

export function IconChart({ active, ...props }) {
  return (
    <svg viewBox="0 0 24 24" {...common} {...props}>
      <path d="M18 20V10" stroke="currentColor" />
      <path d="M12 20V4" stroke="currentColor" />
      <path d="M6 20v-6" stroke="currentColor" />
    </svg>
  );
}

export function IconWallet({ active, ...props }) {
  return (
    <svg viewBox="0 0 24 24" {...common} {...props}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" stroke="currentColor" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" stroke="currentColor" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" stroke="currentColor" />
    </svg>
  );
}

export const navIcons = {
  home: IconHome,
  goals: IconTarget,
  habits: IconChart,
  budget: IconWallet,
};
