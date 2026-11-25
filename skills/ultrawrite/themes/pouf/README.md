# Pouf

Pouf is a soft, "claymorphism" look for a TinyApp built on UI SDK (`@ui-sdk/react`
0.1.0-beta.17): pastel fills, dark ink, big rounded corners, and surfaces that look like
cushions. Each cushion has a white highlight along its top inside edge, a darker lip along
its bottom inside edge, and a soft drop shadow; a pressed button sinks and its cushion
flattens. The look comes from the 1st-Pouf React components (MIT, Mojtaba Beheshti; see
`LICENSE`). The theme is plain CSS over UI SDK's unstyled parts, an embedded Nunito font, and
a few optional layout pieces in `kit.tsx`. It has no behaviour and needs no build step.
Using it, restyling it or ignoring it is the app author's call.

## Load it

A theme is three stylesheets read as text and inlined in this order: the shared
`structure.css` (one folder up), this folder's `font.css`, then this folder's `theme.css`.
Each declares the layer order `ui-sdk, structure, pouf` before any rule, so UI SDK's own
runtime CSS stays underneath, the structure sheet sits above it, and Pouf above both. Any
rule you write outside a layer beats all three. Do not also load `@ui-sdk/core/web.css`.

With plain `Bun.build` and no CSS pipeline, import the files as text and put each in a
`<style>` element in the server render, so the first paint is already styled. The sample
page (`../sample.ts`) does exactly this:

```ts
import { readFileSync } from 'node:fs';

const files = ['themes/structure.css', 'themes/pouf/font.css', 'themes/pouf/theme.css'];
const styles = files
  .map((file) => `<style>${readFileSync(file, 'utf8').replace(/<\/style/gi, '<\\/style')}</style>`)
  .join('\n');

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles}
</head>
<body><div id="root">${markup}</div><script type="module">${clientJs}</script></body>
</html>`;
```

The `<style>` elements sit outside the React root, so hydration leaves them alone and the
client bundle needs no CSS. To see every component in the theme:
`bun skills/ultrawrite/themes/sample.ts --theme pouf`.

## Tokens

All tokens are custom properties on `:root`. To change one, set it in your own unlayered
`:root` rule.

| Token | Value | Use |
| --- | --- | --- |
| `--pouf-bg` | `#f0e9ff` | Page background, and the fill of fields and tracks |
| `--pouf-surface` | `#ffffff` | Cards, dialogs, popups and read-only fields |
| `--pouf-ink` | `#3a2e5c` | Text (10.3:1 on bg) |
| `--pouf-muted` | `#71609b` | Secondary text, placeholders (4.63:1 on bg, 5.46:1 on white) |
| `--pouf-on-accent` | ink | Text on a pastel fill |
| `--pouf-pink` `--pouf-purple` `--pouf-blue` `--pouf-mint` `--pouf-yellow` `--pouf-orange` | pastels | The palette |
| `--pouf-accent` | purple | Default button, stepper buttons, checked checkbox, selected option |
| `--pouf-danger` | orange | Destructive buttons, the field error pill |
| `--pouf-on` | mint | A switch that is on |
| `--pouf-up` `--pouf-down` `--pouf-warn` `--pouf-info` `--pouf-idle` | mint, pink, yellow, blue, purple | Meaning, not colour |
| `--pouf-edge` | `#8a6fd1` | The 2px edge of fields, checkboxes and switches (3.38:1 on bg). An invalid field sets it to the danger edge for whatever it holds |
| `--pouf-ring` | `#6f55b8` | The 3px focus ring inside a field (4.85:1 on bg) |
| `--pouf-danger-edge` | `#c2410c` | The 3px edge of an invalid control (4.39:1 on bg) |
| `--pouf-danger-ink` | `#9a3412` | The label of an invalid field and an invalid number (6.2:1 on bg) |
| `--pouf-focus-outline` | ink | The 3px keyboard focus outline on everything that is not a field |
| `--pouf-font`, `--pouf-font-mono` | Nunito, then rounded system faces; system mono | Fonts. Numbers in a number input use the mono stack |
| `--pouf-radius-card` `-control` `-blob` `-item` `-check` `-pill` | 32, 20, 24, 14, 9, 999px | Corners |
| `--pouf-s1` … `--pouf-s8` | 6, 8, 12, 16, 20, 24, 32, 40px | Spacing |
| `--pouf-lip`, `--pouf-lip-row` | 10px, 6px | How deep a cushion's bottom lip is. Padded surfaces add half of it to their bottom padding, so content looks centred |
| `--pouf-shadow-card` `-control` `-control-active` `-stepper` `-blob` `-row` `-field` `-field-focus` `-field-invalid` `-quiet` `-thumb` | box-shadows | The cushions |
| `--pouf-field-depth` | box-shadow | The recessed top and bottom of a field, under its edge |
| `--pouf-overlay` | ink at 35% | Modal backdrop |
| `--pouf-ease-spring` `-pop` `-slide` `-press` | cubic-beziers | The springy overshoot of pops and slides, and the checkbox's press |
| `--pouf-icon-chevron` `-check` `-minus` `-plus` | SVG data URLs | Icons drawn as masks in `currentColor` |
| `--pouf-tone` | unset | The fill of a button, stepper or badge. Set it with a `.pouf-tone-*` class |

Pouf also sets the structure sheet's sizes: `--theme-dialog-width` (440px, less 32px of
gutter on a narrow screen), `--theme-dialog-max-height`, `--theme-field-gap` (8px) and
`--theme-label-gap` (12px).

## Variants you set

| Attribute | On | Effect |
| --- | --- | --- |
| *(none)* or `data-variant="solid"` | any button-like part | Purple cushion |
| `data-variant="destructive"` | any button-like part | Orange cushion |
| `data-variant="quiet"` | any button-like part | No cushion until hover; for a tertiary action beside a primary one |
| `data-size="sm"` / `"lg"` | any button-like part | 38px / 56px tall (48px by default). Buttons inside a dialog default to `sm` |
| `class="pouf-tone-mint"` (or pink, blue, yellow, orange, purple) | a solid button, a stepper button, a badge | Changes its fill |

Button-like parts are `Button`, `DialogTrigger`, `DialogClose`, `AlertDialogTrigger` and
`AlertDialogClose`; the theme styles all five alike.

## What it styles

- **Button**: rest, a lighter fill on hover, pressed (`:active` or `data-pressed`) sinks 2px,
  keyboard focus, disabled (faded and flattened), `data-pending` (a spinner), and an
  icon-only square (`aria-label` plus a lone `<svg>`).
- **Field** with `FieldLabel` (small uppercase ink), `FieldDescription` (muted) and
  `FieldError` (an orange pill). An invalid field's label turns burnt orange; a disabled
  field fades.
- **Input, Textarea**: a recessed lavender well with a purple edge. Focus thickens the edge
  into a darker ring, invalid makes it burnt orange, read-only turns it into a white well
  with a faint edge.
- **Number Input**: the whole group is one pill-shaped well, the number sits bare in the
  middle, and decrement and increment are round purple cushions with minus and plus drawn by
  the theme. At a bound the step button fades and flattens.
- **Select**: the trigger wears the field look with a chevron that flips when open. The popup
  is a white cushion at least as wide as the trigger that springs open from it. A highlighted
  option gets a recessed well (a thicker ring when you move by keyboard), and a selected
  option a purple fill with a check (if you render `SelectItemIndicator`).
- **Dialog, Alert Dialog**: a blurred ink backdrop and a white card centred with a springy
  pop. Under 900px wide, and whenever UI SDK presents the dialog as a sheet, it is a bottom
  sheet that slides up.
- **Checkbox**: a 28px rounded well that shrinks a little when pressed. Checked or mixed, it
  fills purple and a check or a dash pops in.
- **Switch**: a 60×34 pill track that turns mint when on, and a white cushion thumb that
  springs across. It reverses in right-to-left text.
- A `<label>` (or `Label`) wrapping a checkbox or switch lines them up with the text.

## Kit

`kit.tsx` holds a few layout pieces. They only add class names from `theme.css` and use only
its tokens. Each takes `className`, `style` and any HTML attribute, has no behaviour and needs
nothing but React. Use the classes directly instead if you prefer.

| Piece | Props | Classes |
| --- | --- | --- |
| `Stack` | `gap` 1–8 | `.pouf-stack .pouf-gap-N` (a column) |
| `Row` | `gap`, `align` center/top/stretch, `justify` start/center/between/end, `wrap` | `.pouf-row …` |
| `Card` | `variant` default/tight/flush | `.pouf-card`, `.pouf-card--tight`, `.pouf-card--flush` |
| `Heading` | `level` 1–3 | `.pouf-heading .pouf-h1` (48px), `h2` (28px), `h3` (19px) |
| `Text` | `size` sm/md, `muted`, `num` | `.pouf-text` (`dir="auto"` by default) |
| `Badge` | `tone` | `.pouf-badge .pouf-tone-*` |
| `Separator` | | `.pouf-separator` (an `<hr>`) |

## Styling a component the theme does not cover

Build it from the tokens and the cushion recipes rather than new colours:

- A raised, pressable thing is a pastel fill (`--pouf-tone` or `--pouf-accent`) with
  `--pouf-shadow-control`; pressed, it moves down 2px and takes
  `--pouf-shadow-control-active`.
- A surface (panel, popup, card) is `--pouf-surface` with `--pouf-shadow-card`,
  `--pouf-radius-card` (or `-control` for small popups), and half of `--pouf-lip` added to
  its bottom padding.
- A place you type or choose in is `--pouf-bg` with `--pouf-shadow-field`; focused,
  `--pouf-shadow-field-focus`; invalid, `--pouf-shadow-field-invalid`.
- A row in a list is `--pouf-shadow-row` with `--pouf-radius-item`.
- Write the rule in your own unlayered CSS, or in `@layer pouf` if you want later
  unlayered rules to beat it. Popup placement is UI SDK's (inline styles), so dress and size
  a popup, never move it.

## Known and not fixed

- Solid buttons are under 3:1 against the page on purpose: the purple fill is 1.69:1 and the
  orange destructive fill 1.48:1 against `--pouf-bg`. The cushion's lip and drop shadow mark
  the edge, and the ink label on the fill is well above 4.5:1.
- The gap between a select's trigger and its popup is UI SDK's offset, not the theme's.
- Light only: the theme sets `color-scheme: light` and has no dark tokens.
- Looked at in Chromium only, at 1100px and 375px wide.

## Font

`font.css` embeds Nunito's variable Latin subset (weights 200 to 1000) as a base64 data URL,
so nothing is fetched. Source: the npm package `@fontsource-variable/nunito` version 5.3.0,
file `files/nunito-latin-wght-normal.woff2` (39,128 bytes, sha256
`ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793`). Nunito is © 2014 The
Nunito Project Authors under the SIL Open Font License 1.1; the licence is `OFL.txt`. Text
outside the Latin subset falls back to the rest of `--pouf-font`.
