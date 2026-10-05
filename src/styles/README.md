# `styles/` — global styles and theme tokens

- `theme.css` — the Tailwind v4 `@theme` token block. Colours are token names everywhere else in the
  codebase (`categories.color` stores `'neutral'`, not `#6b7280`), so theming stays central.
- `globals.css` — resets, base element styles, and the `prefers-reduced-motion` defaults.

Tailwind v4 is configured through the Vite plugin; there is no `tailwind.config.js`.
