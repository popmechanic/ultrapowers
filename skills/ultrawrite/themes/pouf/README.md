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

In an app the files sit at `client/src/theme/structure.css` (shared by every theme) and
`client/src/theme/pouf/` (`font.css`, `theme.css`, `kit.tsx`). A theme is the three
stylesheets inlined in this order: `structure.css`, `font.css`, `theme.css`. `structure.css`
declares the layer order `ui-sdk, structure` before any rule and `theme.css` declares
`ui-sdk, structure, pouf`; `font.css` declares no layer (it holds only the `@font-face`). So
UI SDK's own runtime CSS stays underneath, the structure sheet sits above it, and Pouf above
both. Any rule you write outside a layer beats all three. Do not also load
`@ui-sdk/core/web.css`.

Import the three files as text and put each in a `<style>` element in the server render, so
the first paint is already styled. Bun's `with { type: 'text' }` import works both when Bun
runs the server directly and when `Bun.build` bundles it. From a module at `server/page.ts`
(change the `../` paths if yours sits elsewhere):

```ts
import structure from '../client/src/theme/structure.css' with { type: 'text' };
import font from '../client/src/theme/pouf/font.css' with { type: 'text' };
import theme from '../client/src/theme/pouf/theme.css' with { type: 'text' };

const styles = [structure, font, theme]
  .map((css) => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`)
  .join('\n');

export function page(markup: string, clientJs: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${styles}
</head>
<body><div id="root">${markup}</div><script type="module">${clientJs.replace(/<\/script/gi, '<\\/script')}</script></body>
</html>`;
}
```

TypeScript does not know a `.css` import: `bunx tsc --noEmit` in a strict project with
`@types/bun` (1.4.5) fails with "Cannot find module '…css'" on each of the three lines. Add an
ambient declaration anywhere your `tsconfig.json` includes, such as `server/css.d.ts`:

```ts
declare module '*.css' {
  const text: string;
  export default text;
}
```

`markup` is your server render (`renderToString(<App />)`) and `clientJs` your bundled client
script, which hydrates `#root`. The `<style>` elements sit outside the React root, so
hydration leaves them alone and the client bundle needs no CSS. Every component's look is
described under What it styles below.

## Tokens

All tokens are custom properties on `:root`. To change one, set it in your own unlayered
`:root` rule.

| Token | Value | Use |
| --- | --- | --- |
| `--pouf-bg` | `#f0e9ff` | Page background, and the fill of fields |
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
| `--pouf-well-deep` | `#5b4499` | The well of a meter or progress bar (6.52:1 on bg), so every tone's bar reads against it at 3.85:1 or more |
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
| `--pouf-icon-chevron` `-check` `-minus` `-plus` `-x` | SVG data URLs | Icons drawn as masks in `currentColor` |
| `--pouf-tone` | unset | The fill of a button, stepper, badge, segmented or tab thumb, or meter or progress bar. Set it with a `.pouf-tone-*` class |

Pouf also sets the structure sheet's sizes: `--theme-dialog-width` (440px, less 32px of
gutter on a narrow screen), `--theme-dialog-max-height`, `--theme-field-gap` (8px),
`--theme-label-gap` (12px), `--theme-toast-width` (380px, less 32px of gutter) and
`--theme-toast-gap` (12px between toasts in an expanded stack).

## Variants you set

| Attribute | On | Effect |
| --- | --- | --- |
| *(none)* or `data-variant="solid"` | any button-like part | Purple cushion |
| `data-variant="destructive"` | any button-like part | Orange cushion |
| `data-variant="quiet"` | any button-like part | No cushion until hover; for a tertiary action beside a primary one |
| `data-size="sm"` / `"lg"` | any button-like part | 38px / 56px tall (48px by default). Buttons inside a dialog default to `sm` |
| `class="pouf-tone-mint"` (or pink, blue, yellow, orange, purple) | a solid button, a stepper button, a badge, a `SegmentedControl` or `TabsList`, a `Meter` or `Progress`, a `ComboboxTrigger` | Changes its fill |

Button-like parts are `Button`, `DialogTrigger`, `DialogClose`, `AlertDialogTrigger`,
`AlertDialogClose`, `MenuTrigger`, `PopoverTrigger`, `PopoverClose`, `TooltipTrigger` and
`ToastAction`; the theme styles all ten alike. Buttons inside a popover or a toast default to
`sm`, as in a dialog.

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
- **Radio**: a 28px round well like the checkbox. Checked, it fills purple and an ink dot
  springs in (6.1:1 on the purple, like the checkbox's ink check). A `RadioGroup` is a
  column.
- **Segmented Control, Tabs**: one lavender well holding the choices; the chosen one sits on a
  raised purple thumb (`SegmentedControlIndicator`, `TabsIndicator`) that springs across when
  the choice changes. Unchosen choices are muted and brighten on hover. Tabs stack the list
  above the panel.
- **Menu**: the trigger is a button with a chevron that flips while open. The popup is the
  select's white cushion; a highlighted item gets the recessed well, a checkbox or radio item
  shows a check in a gutter at its start, and group labels are small muted capitals between
  soft separators.
- **Popover**: a white cushion that pops from its trigger, with a title, a muted description
  and small buttons in a row.
- **Tooltip**: a small ink chip with lavender text that pops from its trigger.
- **Toast**: a white card at the bottom end of the screen with its title, muted description, a
  small action button and a round close button with an X. It springs up into place; older
  toasts peek out behind the newest and the stack fans out on hover or focus.
- **Combobox**: the label is a field label, the input wears the field look, and the trigger is
  a round purple cushion with a chevron beside the input. Inside a `Field` the theme puts the
  input and trigger on one row; outside one, put them in a row yourself. The popup and its
  options match the select's, and a "no match" line is muted.
- **Meter, Progress**: the label in small capitals with the value at the end of the line, over
  an 18px deep purple pill well with an ink rim and a glossy pastel bar. A meter is blue,
  progress purple and mint once complete; an unknown progress slides a short bar along the
  well. Every tone's bar is at least 3.85:1 against the well (purple; mint 5.87:1), so a full
  bar never reads as an empty one.
- **Separator**: a 2px soft lavender line, horizontal or vertical.
- A `<label>` (or `Label`) wrapping a checkbox, switch or radio lines them up with the text.

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
- The gap between a select's trigger and its popup is UI SDK's offset, not the theme's, and
  the same holds for menus, popovers, comboboxes and tooltips.
- The combobox trigger is a purple cushion, 1.69:1 against the page like the solid buttons;
  its ink chevron is 6.1:1 on the purple.
- The toast's close button is a lavender well on the white card (1.18:1) with a faint edge;
  the ink X in it is 10.3:1.
- Light only: the theme sets `color-scheme: light` and has no dark tokens.
- Looked at in Chromium only, at 1100px and 375px wide; the deep well under the meter and
  progress bars was looked at on a wide page only.

## Font

`font.css` embeds Nunito's variable Latin subset (weights 200 to 1000) as a base64 data URL,
so nothing is fetched. Source: the npm package `@fontsource-variable/nunito` version 5.3.0,
file `files/nunito-latin-wght-normal.woff2` (39,128 bytes, sha256
`ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793`). Nunito is © 2014 The
Nunito Project Authors under the SIL Open Font License 1.1; the licence is `OFL.txt`. Text
outside the Latin subset falls back to the rest of `--pouf-font`.
