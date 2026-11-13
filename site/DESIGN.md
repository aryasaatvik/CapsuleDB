---
version: alpha
name: CapsuleDB site
description: >-
  A developer-tool page in ink on near-white with one accent. Grey does the hierarchy; hairline
  rings and one soft shadow do the elevation. The seal red-orange from the CapsuleDB mark appears
  only where something belongs to a capsule. The memorable element is the boundary shown as a
  real artifact: the capsule's code beside a psql session on the host database it lands in.
colors:
  canvas: "#fafaf9"
  card: "#ffffff"
  inset: "#f4f4f3"
  hairline: "#e7e7e5"
  hairline-strong: "#d4d4d1"
  ink: "#171717"
  body: "#4f4f4d"
  mute: "#6e6e6b"
  seal: "#e2502b"
  seal-ink: "#b23d1a"
  seal-soft: "#fdefe9"
  ready: "#1d6f45"
  ready-soft: "#e4f2ea"
  dark-canvas: "#0c0c0c"
  dark-card: "#131313"
  dark-inset: "#1a1a1a"
  dark-hairline: "#262626"
  dark-ink: "#ededec"
  dark-body: "#a3a3a1"
  dark-mute: "#8e8e8b"
  dark-seal: "#ff6a42"
  dark-seal-ink: "#ff8f6e"
  dark-seal-soft: "#2b1610"
typography:
  hero-display:
    {
      fontFamily: Archivo,
      fontSize: 60px,
      fontWeight: 600,
      lineHeight: 1.04,
      letterSpacing: -0.045em,
    }
  section-title:
    {
      fontFamily: Archivo,
      fontSize: 36px,
      fontWeight: 600,
      lineHeight: 1.12,
      letterSpacing: -0.035em,
    }
  item-title:
    {
      fontFamily: Archivo,
      fontSize: 18px,
      fontWeight: 600,
      lineHeight: 1.3,
      letterSpacing: -0.015em,
    }
  lede: { fontFamily: Archivo, fontSize: 19px, fontWeight: 400, lineHeight: 1.55 }
  body: { fontFamily: Archivo, fontSize: 16px, fontWeight: 400, lineHeight: 1.55 }
  caption: { fontFamily: Archivo, fontSize: 14px, fontWeight: 400, lineHeight: 1.5 }
  code:
    {
      fontFamily: JetBrains Mono,
      fontSize: 13px,
      fontWeight: 400,
      lineHeight: 1.65,
      fontFeatures: "calt 0, liga 0",
    }
rounded: { xs: 4px, sm: 6px, md: 8px, pill: 9999px }
spacing: { xs: 8px, sm: 12px, md: 16px, lg: 24px, xl: 40px, section: 96px }
elevation:
  ring: "0 0 0 1px rgba(0,0,0,.08)"
  lift: "0 0 0 1px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04), 0 12px 24px -12px rgba(0,0,0,.08)"
semantic:
  background: "{colors.canvas}"
  foreground: "{colors.ink}"
  muted: "{colors.inset}"
  muted-foreground: "{colors.body}"
  border: "{colors.hairline}"
  accent: "{colors.seal-ink}"
  action: "{colors.ink}"
components:
  button-primary:
    {
      backgroundColor: "{colors.ink}",
      textColor: "{colors.canvas}",
      typography: "{typography.body}",
      rounded: "{rounded.pill}",
      height: 44px,
    }
  command:
    {
      backgroundColor: "{colors.card}",
      shadow: "{elevation.ring}",
      typography: "{typography.code}",
      rounded: "{rounded.md}",
    }
  window: { backgroundColor: "{colors.card}", shadow: "{elevation.lift}", rounded: "{rounded.md}" }
  window-bar:
    {
      borderBottom: "{colors.hairline}",
      typography: "{typography.code}",
      textColor: "{colors.body}",
    }
  capsule-row:
    {
      backgroundColor: "{colors.seal-soft}",
      ruleLeft: "2px {colors.seal}",
      textColor: "{colors.seal-ink}",
    }
  status-ready:
    { backgroundColor: "{colors.ready-soft}", textColor: "{colors.ready}", rounded: "{rounded.xs}" }
  step-number:
    {
      backgroundColor: "{colors.card}",
      shadow: "{elevation.ring}",
      rounded: "{rounded.xs}",
      typography: "{typography.code}",
    }
  hairline-table:
    { border: "{colors.hairline}", headerBackground: "{colors.inset}", rounded: "{rounded.md}" }
---

# CapsuleDB site design

Tokens live in `theme.css` (`--blume-*` drive Blume's chrome, `--cx-*` drive the landing page) and
the code themes in `themes/`. This file explains how to use them.

## Overview

The page sells a boundary: what a package owns versus what the host owns. So the design is quiet
everywhere except the one place that boundary is visible.

Key characteristics:

- Ink on near-white, a grey ladder for hierarchy, nothing warm in the ground.
- One accent, `{colors.seal}`, used only for capsule-owned things.
- Elevation is a 1px ring, plus `{elevation.lift}` on the hero window and the film. Nothing else.
- Radii stay at 8px or less. The only pill is the primary button; the only rounded shape beyond
  that is the brand mark.
- Headings at weight 600 with tight tracking; no heavier weight anywhere.
- Code is monochrome: keywords in ink, everything else grey. Colour in code would compete with the
  accent.
- Real artifacts only: every code block is a region of `examples/`, every table name is one the
  conformance tests create.

This is not the launch-film look (warm paper, rounded capsule pills), not a cream editorial page,
and not a PageGraph clone: PageGraph centres its hero, uses Bricolage Grotesque and a blue accent,
and colours its code.

## Colors

**The Seal Rule.** `{colors.seal}` marks only what belongs to a capsule: its namespace prefix, its
rows in a table listing, its rule. It also carries focus rings. It never fills a button, a heading,
or a background larger than a table row.

- Brand and accent: `{colors.seal}` for marks and rules; `{colors.seal-ink}` for accent text (it
  meets AA on `{colors.card}`); `{colors.seal-soft}` for capsule-row washes.
- Status: `{colors.ready}` on `{colors.ready-soft}` only for a real Ready state. No decorative
  status dots.
- Surface: `{colors.canvas}` page, `{colors.card}` windows and tables, `{colors.inset}` table heads,
  inline code, and secondary buttons.
- Text: `{colors.ink}` headings and emphasis, `{colors.body}` prose, `{colors.mute}` captions,
  labels, and prompts.
- Hairlines: `{colors.hairline}` between rows and sections, `{colors.hairline-strong}` for dashed
  separators.
- Dark mode swaps each token for its `dark-*` twin; the seal lifts to `{colors.dark-seal}` so it
  holds contrast.

## Typography

Archivo for everything set in prose; JetBrains Mono for code, commands, schema, and table names,
with contextual alternates off so `=>` stays two characters.

| Role    | Token                        |
| ------- | ---------------------------- |
| Hero    | `{typography.hero-display}`  |
| Section | `{typography.section-title}` |
| Item    | `{typography.item-title}`    |
| Lede    | `{typography.lede}`          |
| Body    | `{typography.body}`          |
| Caption | `{typography.caption}`       |
| Code    | `{typography.code}`          |

**The 600 Ceiling.** No weight above 600. Hierarchy comes from size, tracking, and grey.

Sentence case for every heading and label. No tracked uppercase kickers above headings.

## Layout

Left-aligned hero copy (max 760px) over a full-width two-pane window. Sections below sit on a
1160px measure, separated by a single hairline, with `{spacing.section}` padding. Steps are a
numbered list (they are a real sequence): copy left at 0.72fr, code right at 1.28fr.

## Components

- **Window** (`{components.window}`): a bar with a file path or command on the left, a muted
  detail on the right, then the content. Used for code and the psql session.
- **Capsule row** (`{components.capsule-row}`): a table row owned by a capsule. Namespace prefix in
  seal-ink, a 2px seal rule on the first cell.
- **Primary button** (`{components.button-primary}`): one per view, to the quick start.
- **Command** (`{components.command}`): the install command with a Copy button.
- **Hairline table** (`{components.hairline-table}`): providers and similar matrices.

## Shapes

`{rounded.md}` on windows and tables, `{rounded.sm}` on buttons inside them, `{rounded.xs}` on
badges and inline code. Nothing larger.

## Elevation & Depth

**One Lift.** `{elevation.lift}` appears on at most two surfaces per page: the hero window and the
film. Everything else uses `{elevation.ring}` or a hairline.

## Do's and Don'ts

- Do show the boundary with real names from `examples/` and the conformance tests.
- Do keep the accent under a tenth of any screen.
- Don't add a second accent, a gradient, glass, glow, or a warm ground.
- Don't draw capsules as pills or rounded containers.
- Don't hand-write code that claims to be CapsuleDB usage.
- Don't use em dashes in page copy.

## Responsive Behavior

Below 920px the hero window stacks with the psql pane first, steps and the film row become one
column, and grids collapse to one column. Below 520px the psql text drops to 11.5px, long table
names wrap after the namespace prefix, and the install command fills the width. No horizontal page
scroll at 375px; wide tables scroll inside their own region.

## Iteration Guide

Change tokens in this file's front matter and `theme.css` together. A new section must name which
side of the boundary it serves, and earn its place with an artifact rather than a paragraph.

## Tuning Knobs

- **Accent intensity:** capsule-row wash from 50% to 80% of `{colors.seal-soft}`.
- **Split ratio:** hero panes from 1:1 to 1:1.15 (code : database).
- **Section rhythm:** `{spacing.section}` from 64px to 112px.

## Known Gaps

Forms, error states beyond the 404, and interactive demos are not designed. The launch film and
infographics are rendered from `media/` with its own tokens; keep them in step with this sheet.
