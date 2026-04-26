---
name: brand-guidelines-presentation
description: >
  Create comprehensive, professional brand guideline presentations as polished .pptx files.
  Use this skill whenever a user asks to create brand guidelines, a brand book, brand identity documentation,
  visual identity guide, style guide, or any presentation that defines how a brand looks and feels.
  Also trigger when the user says things like "document our brand as a deck", "create a brand kit presentation",
  "make brand rules slides", "write up our visual identity as a PowerPoint", "build a style guide deck",
  or uploads brand assets and asks to formalize them into a presentation.
  This skill covers all four core pillars: Logo, Typography, Color Palette, and Brand Elements.
  Always use this skill when brand documentation is requested as a presentation, deck, or .pptx file —
  even partial guides (e.g., "just the colors and fonts as slides").
---

# Brand Guidelines Presentation Skill

This skill produces **professional, publication-ready brand guideline presentations** — the kind agencies charge tens of thousands for. The output is a polished `.pptx` deck styled to reflect the brand itself, covering all pillars of visual identity. Dark mode only.

---

## STEP 0 — Read the PPTX skill first

Before writing any code, read `/mnt/skills/public/pptx/SKILL.md` for technical implementation standards (pptxgenjs, QA loop, visual inspection). The brand guidelines deck must meet those standards — no generic AI aesthetics, no boring layouts.

---

## STEP 1 — Gather Brand Information

Before generating anything, collect:

### Required inputs
- **Brand name** (e.g., "Antigravity", "Optimizers")
- **Brand tagline / mission statement** (e.g., "We make optimization Simple, Practical, and Profitable")
- **Industry / target audience** (e.g., e-commerce, fintech, healthcare)
- **Primary color(s)** — hex codes if known; otherwise describe the vibe
- **Fonts** — if specified; otherwise Claude selects from system-safe fonts that match the brand personality
- **Logo description or SVG** — if provided; otherwise Claude designs an SVG wordmark to embed
- **Brand personality keywords** (e.g., bold + modern + trustworthy, or playful + minimal + fresh)

### Optional but valuable
- Existing logo files (SVG/PNG)
- Competitor references ("feel like X but more Y")
- What NOT to do aesthetically

### If the user has uploaded a brand guidelines PDF
Extract all specs from it — colors, fonts, logo rationale, rules — and use them to populate the deck faithfully.

---

## STEP 2 — Slide Deck Structure

Every brand guidelines presentation follows this architecture, matching professional agency deliverables:

```
Slide 1:   Cover — Brand name, tagline, logo
Slide 2:   Table of Contents — 4 sections with section numbers
Slide 3:   Section Divider — 01. Brand Logo
Slide 4:   Logo Rationale — Concept behind the logo
Slide 5:   Final Logo — Logo on dark + light backgrounds
Slide 6:   Logo Color Variations — Full color / monochrome / reversed
Slide 7:   Logo Correct Usage — 4+ correct usage examples
Slide 8:   Logo Wrong Usage — 6 don'ts with visual examples
Slide 9:   Section Divider — 02. Brand Typography
Slide 10:  Primary Font — Full alphabet specimen + weight showcase
Slide 11:  Type Hierarchy — H1 → H2 → H3 → Body progression
Slide 12:  Section Divider — 03. Brand Color Palette
Slide 13:  Primary Colors — Color swatches with HEX, RGB, CMYK
Slide 14:  Color Usage Rules — Do/don't color combinations
Slide 15:  Section Divider — 04. Brand Elements
Slide 16:  Iconography Style — 8–12 sample icons in brand style
Slide 17:  Photography / Image Style — Mood board or image direction
Slide 18:  Patterns & Textures — Brand pattern using logo monogram
Slide 19:  UI Elements — Buttons, cards, tags in brand style
Slide 20:  Closing Slide — Thank you / contact / website
```

Adjust slide count up or down based on brand complexity.

---

## STEP 3 — Visual Design Rules

### Global Aesthetic: Dark Mode Only
- **All slides use a dark background** — the brand's darkest color or near-black (`#0A0A0A`–`#1A1A2E` range)
- **No light/white backgrounds** at all — this is a dark-mode-only deck
- **Primary accent color** pops against the dark ground
- **White or light-tinted text** for all body copy
- **Section divider slides** use the brand accent as a bold full-bleed background

### Cover Slide
- Full-bleed dark background
- Logo centered or top-left, large and prominent
- Brand tagline in display size (44–52pt) using the primary accent color
- Subtle low-opacity repeating pattern using the brand monogram/icon (8–12% opacity)
- Brand name in bold, brand tagline below in accent color

### Section Divider Slides
- Full-bleed **accent color** background (not dark — this is the contrast beat)
- Large section number (01, 02…) at 80–100pt, dark-colored or white
- Section title at 36–44pt
- Short descriptor or brand tagline at 16pt
- Minimal decoration — let the color do the work

### Table of Contents
- Dark background
- 4 section cards or numbered rows
- Each row: section number in accent + section title in white
- Optional: small icon or preview for each section

### Color Swatch Slides
- Each swatch: a tall rounded rectangle filled with the brand color
- Below each swatch: Color name, HEX, RGB, CMYK values in white/light text
- Show at least 4–6 colors: primary, secondary, accent, dark, darkest, white/light
- Layout: 4–6 swatches in a single row or 2-row grid

### Typography Specimen Slides
- Show font name prominently
- Full uppercase + lowercase alphabet + numerals at ~14–16pt
- Show each weight: Light, Regular, Medium, SemiBold, Bold, ExtraBold
- Each weight labeled clearly
- Use white text on dark background for all specimens

### Logo Do/Don't Slide
Two-column layout, dark background:
- **Left column** (✅ Correct): 4 correct usage examples with green checkmark labels
- **Right column** (❌ Don't): 6 wrong usages with red X labels
  - Don't rotate
  - Don't recolor outside brand palette
  - Don't outline / stroke
  - Don't stretch or distort
  - Don't add drop shadow
  - Don't add extra decorative elements

### Icon Slide
- Dark background
- 8–12 icons arranged in a grid
- Each icon rendered in the accent color on a slightly lighter dark tile
- Icon captions in small white text below each
- Line style: minimal, 2px stroke weight, rounded caps and joins
- Size grid: designed on 24×24 or 32×32 px logical grid

### UI Elements Slide
- Show button states on dark background:
  - **Primary button**: accent color fill, dark text
  - **Secondary button**: outlined, no fill, accent border + text
- Show at least one card component: dark card with subtle border, title + body text
- Show tag/badge components in accent color

### Closing Slide
- Full-bleed dark background
- Large logo centered
- Thank-you message or closing tagline
- Website / contact info in accent color at bottom
- Same low-opacity pattern as cover for visual bookend

---

## STEP 4 — Color System

Use this hierarchy when building from 1–2 seed colors:

```
Brand Darkest:  Near-black (background base)         e.g. #020601
Brand Dark:     Slightly lighter (cards, panels)     e.g. #0E1C26
Brand Primary:  Main accent / action color           e.g. #6AE499
Brand Secondary: Supporting accent                   e.g. #3ABFCF
Brand White:    Text and light elements              e.g. #FFFFFF
Brand Muted:    Subdued text / metadata              e.g. #8899AA
```

Always show HEX, RGB, and CMYK for each color swatch:
- HEX: `#6AE499`
- RGB: `106, 228, 153`
- CMYK: `52, 0, 57, 0`

CMYK conversion: C = (1 - R/255) / (1 - K), where K = 1 - max(R,G,B)/255

---

## STEP 5 — Logo SVG / Image Embedding

If no logo is provided, design a wordmark SVG using brand initials:

- Use brand accent color for the icon/monogram element
- Use white for the wordmark text (for dark backgrounds)
- Keep it geometric and clean — avoid decorative serifs
- The icon concept should relate to the brand domain
  - Loops, arrows, motion → "Optimizers"
  - Gravity, orbit, lift → "Antigravity"
  - Shield, lock → security brands

Embed logos in slides using pptxgenjs `addImage()` with SVG or PNG data.

For background patterns (cover + closing):
- Export logo icon as SVG, embed as repeated low-opacity image elements across the slide
- Target 8–15% opacity
- Rotate at various angles for texture

---

## STEP 6 — Font Selection

Since pptxgenjs uses system fonts, choose from safe options that match brand personality:

| Brand Personality     | Header Font     | Body Font       |
|-----------------------|-----------------|-----------------|
| Bold + Modern         | Arial Black     | Arial           |
| Executive + Premium   | Georgia         | Calibri         |
| Tech + Minimal        | Calibri         | Calibri Light   |
| Classic + Trustworthy | Cambria         | Calibri         |
| Energetic + Creative  | Trebuchet MS    | Arial           |
| Luxury + Editorial    | Palatino        | Garamond        |

Type size scale:
| Element            | Size     |
|--------------------|----------|
| Cover title        | 44–52pt  |
| Slide title        | 36–44pt  |
| Section header     | 20–24pt  |
| Body text          | 14–16pt  |
| Captions / labels  | 10–12pt  |

---

## STEP 7 — pptxgenjs Implementation Notes

```javascript
// Slide size: widescreen 16:9 (default)
pptx.layout = 'LAYOUT_WIDE'; // 13.33" x 7.5"

// Dark background on every slide
slide.background = { color: '020601' }; // brand darkest

// Accent-colored section divider
slide.background = { color: '6AE499' }; // brand primary

// Color swatch rectangle
slide.addShape(pptx.ShapeType.roundRect, {
  x: 0.5, y: 1.0, w: 1.8, h: 3.5,
  fill: { color: '6AE499' },
  line: { color: '6AE499' },
  rectRadius: 0.15
});

// Swatch label below
slide.addText('Pastel Green\n#6AE499\nRGB 106,228,153\nCMYK 52,0,57,0', {
  x: 0.5, y: 4.6, w: 1.8, h: 1.5,
  fontSize: 9, color: 'CCDDEE', align: 'center'
});

// Typography specimen block
slide.addText('ABCDEFGHIJKLMNOPQRSTUVWXYZ\nabcdefghijklmnopqrstuvwxyz\n1234567890', {
  x: 0.5, y: 2.0, w: 12.0, h: 1.5,
  fontFace: 'Arial', fontSize: 14,
  color: 'FFFFFF', bold: false
});
```

---

## STEP 8 — Quality Checklist

Before delivering the `.pptx`, verify:

- [ ] Cover uses dark background + large display typography + logo + tagline in accent color
- [ ] All 4 section divider slides present with full-bleed accent color background
- [ ] Color swatches show HEX + RGB + CMYK for each color
- [ ] At least 3 font weights showcased with full alphabet specimens
- [ ] Logo usage slide has at least 4 correct + 6 incorrect (don't) examples
- [ ] Type hierarchy slide shows H1 → H2 → H3 → Body progression
- [ ] No light/white background on any slide (dark mode only)
- [ ] Icon grid has at least 8 icons styled consistently
- [ ] UI elements slide shows primary + secondary button + at least one card
- [ ] Closing slide mirrors cover aesthetic for visual bookend
- [ ] Run visual QA using subagent + slide images per PPTX skill instructions
- [ ] No text overflow, no overlapping elements, no placeholder content remaining
- [ ] Every slide has at least one visual element (shape, icon, swatch, image) — no text-only slides

---

## Common Mistakes to Avoid

- **Don't use white or light backgrounds** — dark mode throughout, no exceptions
- **Don't use accent lines under titles** — use whitespace or color blocks instead
- **Don't repeat the same layout** — vary columns, grids, and callouts across slides
- **Don't use low-contrast text** — all body text must be white or light-tinted on dark
- **Don't skip the section divider color contrast beat** — accent-colored dividers are essential pacing
- **Don't add decorative header/footer bars** — these read as generic AI output
- **Don't ship text that overflows its shape** — resize or split content first
- **Don't default to cream/beige** — dark backgrounds only
