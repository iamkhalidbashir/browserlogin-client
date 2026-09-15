# BrowserLogin Interface Contract

## Product Direction

BrowserLogin is a compact desktop control center for operational browser
sessions. The interface should feel trustworthy, direct, and technical rather
than decorative. Prefer clear state, explicit actions, and short explanatory
copy.

## Visual System

- Typography: Inter with the existing sans-serif fallbacks. Use the established
  heading, eyebrow, body, and small-status scales.
- Color: zinc surfaces and borders, emerald for primary actions and active
  navigation, red for destructive actions, and amber only for explicit risk.
- Surfaces: use `panel`, `metric-card`, `status-pill`, and existing Tailwind
  spacing. Do not introduce new card treatments or gradients.
- Controls: use `button-primary`, `button-secondary`, `button-danger`, `field`,
  and `check-field`. Preserve the shared disabled and focus-visible behavior.
- Themes: all changes must remain legible in the existing system light and dark
  themes.

## Interaction Rules

- Never claim success, connectivity, or currency before the corresponding
  operation has completed successfully.
- Keep automatic update behavior check-only. Downloading and installing require
  explicit user actions.
- Show update progress in order: checking, availability, downloading, ready,
  installing and restarting. Errors take precedence over current-state copy.
- Disable actions that are invalid for the current state rather than accepting
  speculative operations.
- Announce asynchronous status with an accessible live region and preserve
  keyboard focus visibility.

## Layout

- Preserve the existing sidebar, header, two-column Settings grid, and panel
  order.
- Behavior-only work must not add ornamental layout, animation, or dependencies.
- Long status text must wrap within its panel without changing the application
  minimum window size.
