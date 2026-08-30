/** Merchant / keyword → expense category. First match wins. */
const RULES = [
  [/swiggy/i, 'Food'],
  [/amazon/i, 'Shopping'],
  [/uber/i, 'Travel'],
];

/**
 * @param {string} text description or SMS body
 * @returns {string | null} category if a rule matched, else null
 */
export function inferCategoryFromText(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const [pattern, category] of RULES) {
    if (pattern.test(trimmed)) return category;
  }
  return null;
}
