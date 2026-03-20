# Terminal Top Chrome Design

**Goal:** Restyle only the pane-level top terminal chrome shown in the screenshot so it feels intentional and tool-like without changing the toolbar, terminal body, or Ghostty rendering area.

## Visual Direction

Use a compact "operator label" treatment:

- A lower-profile session header that visually caps the terminal body
- A title lockup on the left with a small status marker and tighter typography
- A quieter close affordance on the right that becomes obvious only on hover
- A restrained accent treatment for the active pane instead of flat purple text on black

## Scope

In scope:

- The pane title row in `src/features/terminal/TerminalPanel.tsx`
- The session label and kill button inside that row

Out of scope:

- The toolbar above the panes
- Empty pane states
- Ghostty terminal body/background
- App-level tab bar or title bar

## Layout

The row stays a single horizontal line:

- Left: session label with subtle status indicator
- Right: compact dismiss/kill action

The row should be slightly shorter and denser than the current version. It should read as terminal chrome, not as raw text dropped on a black strip.

## Styling

- Use a very dark charcoal base with a slight tonal shift from the body below
- Add a faint bottom border so the row feels anchored
- Give the label a stronger hierarchy through weight, spacing, and muted metadata text
- Use a small status dot instead of relying on bright title text
- Active panes get a subtle tinted background wash
- Destructive actions stay neutral until hover, then shift red

## Interaction

- Existing behavior remains unchanged
- Hover states become clearer and more polished
- Empty panes still communicate startup/terminal state without dominating the row

## Validation

Success looks like:

- The chrome no longer resembles default OS or placeholder styling
- The pane title reads clearly without shouting
- The close action feels deliberate instead of bolted on
- The row visually fits the rest of the app without redesigning the whole terminal panel
