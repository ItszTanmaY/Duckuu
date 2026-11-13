---
name: Warm Editorial Print
colors:
  surface: '#fbf9f5'
  surface-dim: '#dbdad6'
  surface-bright: '#fbf9f5'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ef'
  surface-container: '#efeeea'
  surface-container-high: '#eae8e4'
  surface-container-highest: '#e4e2de'
  on-surface: '#1b1c1a'
  on-surface-variant: '#4b4640'
  inverse-surface: '#30312e'
  inverse-on-surface: '#f2f0ed'
  outline: '#7c766f'
  outline-variant: '#cdc5bd'
  surface-tint: '#605e5c'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#1d1b1a'
  on-primary-container: '#868381'
  inverse-primary: '#cac6c3'
  secondary: '#8d4f00'
  on-secondary: '#ffffff'
  secondary-container: '#fe940f'
  on-secondary-container: '#643600'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#1c1b1c'
  on-tertiary-container: '#858384'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e6e1df'
  primary-fixed-dim: '#cac6c3'
  on-primary-fixed: '#1d1b1a'
  on-primary-fixed-variant: '#484645'
  secondary-fixed: '#ffdcc0'
  secondary-fixed-dim: '#ffb876'
  on-secondary-fixed: '#2d1600'
  on-secondary-fixed-variant: '#6b3b00'
  tertiary-fixed: '#e5e2e3'
  tertiary-fixed-dim: '#c8c6c7'
  on-tertiary-fixed: '#1c1b1c'
  on-tertiary-fixed-variant: '#474647'
  background: '#fbf9f5'
  on-background: '#1b1c1a'
  surface-variant: '#e4e2de'
typography:
  display-xl:
    fontFamily: Newsreader
    fontSize: 96px
    fontWeight: '300'
    lineHeight: 100px
    letterSpacing: -0.03em
  display-lg:
    fontFamily: Newsreader
    fontSize: 64px
    fontWeight: '400'
    lineHeight: 68px
    letterSpacing: -0.025em
  display-lg-mobile:
    fontFamily: Newsreader
    fontSize: 40px
    fontWeight: '400'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Newsreader
    fontSize: 36px
    fontWeight: '400'
    lineHeight: 42px
    letterSpacing: -0.015em
  headline-md:
    fontFamily: Newsreader
    fontSize: 26px
    fontWeight: '500'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Hanken Grotesk
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Hanken Grotesk
    fontSize: 15px
    fontWeight: '400'
    lineHeight: 24px
  body-sm:
    fontFamily: Hanken Grotesk
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 20px
  meta-mono:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 14px
    letterSpacing: 0.04em
  label-caps:
    fontFamily: Hanken Grotesk
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 14px
    letterSpacing: 0.08em
spacing:
  gutter: 1.5rem
  gutter-desktop: 2.5rem
  margin: 1.5rem
  margin-desktop: 3.5rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.75rem
  space-xl: 3rem
---

## Brand & Style

This design system defines an intimate, cerebral desktop environment tailored for thoughtful writing, reflection, and AI collaboration. Rather than adopting the typical glossy or utilitarian SaaS aesthetic, the interface draws structural authority from broadsheet publishing, Swiss typographic grids, and archival stationery.

### Personality & Tone
- **Atmospheric & Tactile:** Mimics the presence of warm, heavyweight uncoated paper, dense printer's ink, and deliberate editorial craftsmanship.
- **Quiet Confidence:** Generous void space, concise declarations, and absolute restraint over decorative embellishment.
- **Structural Rigor:** Prominent structural hairline rules define layout frames, visible column registers, and metadata brackets.
- **Literary Subversion:** Elevated high-contrast typography juxtaposed against a single, razor-sharp stroke of playful amber orange.

### Aesthetic Rules
- Absolutely no soft drop shadows, background blurs, or gradients.
- Surfaces are matte and opaque; separation is handled strictly through structural stone hairpins and deliberate micro-margins.
- Metadata is always typographically demoted using parentheses, uppercase letterspaced grotesk, or monospaced indices (e.g., `(version: 0.9.4)`, `01 / 04`, `[cmd + k]`).

## Colors

The palette is rooted in tactile printmaking: unbleached cotton stock, deep carbon ink, weathered stone boundaries, and a singular, electric amber orange signal.

### Palette Architecture
- **Canvas / Parchment Base (`#FBF9F5`):** The foundational substrate across all views. Evokes warm, uncoated rag paper.
- **Surface Elevation (`#F5F2EB`):** Used for sidebar rails, inset dialogue panels, metadata plaques, and active input reservoirs.
- **Ink Primary (`#121110`):** The near-black pigment for primary editorial headlines, body text, and solid iconography.
- **Ink Muted (`#6E6B65`):** Used for parenthetical tags, section counters, secondary notes, and footnote citations.
- **Structural Stone (`#E6E2D8`):** 1px borders, grid dividers, column splitters, and hairline rules.
- **Amber Signal Orange (`#F58D00`):** The solitary focal accent. Reserved strictly for active caret indicators, AI presence pings, active state chips, and focal action triggers. Never tint or dilute; use purely as an opaque hit of spot color.

## Typography

The typographic hierarchy creates a high-tension dialogue between the classic literary authority of **Newsreader** (italicized accents, ultra-light large displays), the architectural clarity of **Hanken Grotesk**, and the mechanical documentation cadence of **JetBrains Mono**.

### Typographic Rules
- **Display Weights:** In oversized display titles, alternate within the same sentence between `fontWeight: 300` (Newsreader Light) and `fontWeight: 600` (Newsreader SemiBold/Italic) to replicate bespoke editorial titling.
- **Section Counters & Metadata:** Prepend section headers with fixed mono markers (`01 / 03`, `(draft: revision_04)`). Keep them strictly set in JetBrains Mono at 11px.
- **Directional Links:** Hyperlinks and inline action triggers use text followed by an explicit thin arrow: `Read entry →` or `Consult Duckuu ↗`.

## Layout & Spacing

Layouts are treated as uncompromised editorial spreads, utilizing deliberate structural divisions rather than floating content islands.

### Desktop Grid Framework
- **Architecture:** 12-column asymmetric desktop grid with an omnipresent 1px hairline stone border (`#E6E2D8`) separating persistent app rails from reading stages.
- **The Anchor Margin:** Desktop environments establish a wide exterior breathing perimeter (`3.5rem`), pulling the core writing surface toward human eye level.
- **Section Partitioning:** Vertical layouts demarcate segments using horizontal full-bleed structural rules punctuated by right-aligned parenthetical counters (`01 / 05`).
- **Whitespace Densities:** Vast expanses of negative space (`space-xl` and above) are used intentionally around critical reading moments, balanced by dense, hyper-compact metadata blocks in the toolbars.

## Elevation & Depth

This design system discards atmospheric depth, z-index illusions, dropshadows, and frosted materials in favor of absolute planar discipline.

### Planar Architecture
- **Zero Shadow Standard:** Elevation is never expressed via blur or drop shadow (`box-shadow: none`).
- **Tonal Inset:** Depth is conveyed exclusively by resting `#F5F2EB` (Surface Inset) planes directly against the baseline `#FBF9F5` (Canvas Parchment).
- **Hairline Framing:** Layering is communicated via crisp `1px solid #E6E2D8` borders. When an item gains focus or elevation (such as a modal or companion prompt drawer), it uses an opaque background with a continuous `1px solid #121110` perimeter frame, creating a stark, high-contrast mechanical registration.
- **Accent Indexing:** Active focal items (such as the current cursor row or active assistant thread) indicate presence using a 2px left border in `#F58D00`.

## Shapes

Every component in the interface follows a rigorous, zero-radius geometric philosophy (`0px` border radius). 

### Structural Discipline
- **Architectural Corners:** All modals, buttons, chips, panels, dialogue blocks, and tooltips are cut square.
- **Editorial Cleanliness:** Sharp corners reinforce the feeling of printed sheets, trimmed parchment, and razor-sharp column registers.
- **Accents:** Minor status pings or presence dots may render as 4px circular ink dots, but all structural containers remain strictly perpendicular.

## Components

### Buttons
- **Primary:** Solid `#121110` background, `#FBF9F5` text, 0px border radius, uppercase JetBrains Mono or Hanken Grotesk (`12px`, letter spacing `0.06em`). Hover swaps background to Amber Signal Orange (`#F58D00`) with `#121110` ink text.
- **Ghost / Editorial Link:** Transparent background, zero border, inline text with directional indicator (`Explore dialogue →`). Hover adds a 1px solid `#121110` underline offset by 4px.
- **Frame Action:** Transparent background with `1px solid #E6E2D8`. Padding: `0.5rem 1rem`. Hover transitions border to `#121110`.

### Chips & Metadata Tags
- Monospaced badges enclosed strictly in typographic brackets or parentheses: `( duckuu / ready )` or `[ 4,210 tokens ]`.
- Set in 11px JetBrains Mono with `#6E6B65` ink on transparent backgrounds.
- Active or alert tags render with an opaque `#F58D00` solid pill or block indicator preceding the copy.

### Text Inputs & Companion Prompts
- Large editorial field with no surrounding container box; simply rests above a persistent bottom hairline border (`1px solid #E6E2D8`).
- Active focus state shifts the hairline to `1px solid #121110`, with a blinking solid `#F58D00` amber orange block caret.
- Companion dialogue input: Framed inset block (`#F5F2EB`) surrounded by `1px solid #E6E2D8` with fixed monospaced command indicator at bottom right `(enter to dispatch ↵)`.

### Lists & Dialogue Streams
- Threaded discussions do not use floating chat bubbles.
- AI and user exchanges sit flush within column registers separated by continuous horizontal hairline rules (`1px solid #E6E2D8`).
- The assistant is marked by a compact mono label: `DUCKUU / 01` accompanied by a small amber orange square icon (`6px × 6px` in `#F58D00`), followed directly by longform Newsreader prose.

### Cards & Inset Panels
- Strictly avoid rounded consumer card modules.
- Content groupings exist as unpadded grid cells bounded by structural stone borders (`1px solid #E6E2D8`).
- Header panels display small categorical numbering on the left (`02`) and time/context data in parentheses on the right `(saved: 12m ago)`.