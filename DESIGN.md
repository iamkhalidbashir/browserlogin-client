# BrowserLogin Interface Contract

## Product Direction

BrowserLogin is a compact desktop control center for operational browser
sessions. The interface should feel trustworthy, direct, and technical rather
than decorative. Prefer clear state, explicit actions, and short explanatory
copy.

## Visual System

- Typography: Inter with the existing sans-serif fallbacks. Use the established
  heading, eyebrow, body, and small-status scales.
- Color: light zinc surfaces are the default, emerald marks primary actions and
  active navigation, red marks destructive actions, and amber is reserved for
  explicit risk. The application remains light regardless of the operating
  system color preference.
- Surfaces: use `panel`, `metric-card`, `status-pill`, and existing Tailwind
  spacing. Do not introduce new card treatments or gradients.
- Controls: use `button-primary`, `button-secondary`, `button-danger`, `field`,
  and `check-field`. Preserve the shared disabled and focus-visible behavior.
- Themes: use the light application palette consistently across every route.

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
- Keep profile launch and stop activity visible in the bottom-right activity
  stack. Show indeterminate progress while preparing, then switch to verified
  transfer percentages when byte counts are available.
- Collect contextual input and destructive confirmations in a fixed modal,
  never by appending controls below the triggering table or panel. Label every
  dialog, move focus inside it, contain keyboard focus, support Escape, and
  restore focus to the trigger when it closes.

## Layout

- Preserve the existing sidebar, header, two-column Settings grid, and panel
  order.
- On desktop, bound the application shell to the dynamic viewport. Keep the
  left sidebar stationary and let the right content column own vertical
  scrolling; retain normal document flow on narrow layouts.
- Behavior-only work must not add ornamental layout, animation, or dependencies.
- Long status text must wrap within its panel without changing the application
  minimum window size.
