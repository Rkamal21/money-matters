export const XP_PER_LEVEL = 100;

export const CATEGORIES = [
  { value: 'Food', label: '🍕 Food' },
  { value: 'Transport', label: '🚗 Transport' },
  { value: 'Travel', label: '✈️ Travel' },
  { value: 'Shopping', label: '🛍️ Shopping' },
  { value: 'Bills', label: '📱 Bills' },
  { value: 'Other', label: '💸 Other' },
];

export const CATEGORY_ICON = {
  Food: '🍕',
  Transport: '🚗',
  Travel: '✈️',
  Shopping: '🛍️',
  Bills: '📱',
  Other: '💸',
};

export function getCategoryIcon(category) {
  return CATEGORY_ICON[category] || '💸';
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function yesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function isThisMonth(isoDate) {
  const d = new Date(isoDate);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}

export function isToday(isoDate) {
  return isoDate && isoDate.startsWith(todayStr());
}
