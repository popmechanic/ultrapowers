# Writing a TinyApp theme

A theme is how a TinyApp's UI SDK components look. It is plain CSS and, optionally, a few
layout components: no behaviour, no build step, no `@import`, and no `url()` but a `data:`
URL. UI SDK supplies the behaviour; `structure.css` here supplies what makes each part work
(dialog centring, the popover reset, indicator positions, the toast stack). A theme supplies
everything a person sees. You do not need to read `structure.css`: `contract.json` says what
it does for each part and what is left to you.

## The folder

A theme is one folder. Its name is the theme's layer name, so it must be a plain identifier
(a letter, then letters, digits, hyphens or underscores) other than `ui-sdk` or `structure`.

| File | Needed | What it holds |
| --- | --- | --- |
| `theme.css` | yes | Every rule, inside `@layer <name> { … }` |
| `README.md` | yes | How to load it, its tokens and variants, and where it falls short |
| `LICENSE` | yes | The theme's licence |
| `font.css` | no | `@font-face` rules only, with the font as a `data:` URL; it is inlined before `theme.css` |
| `kit.tsx` | no | Layout components (a stack, a card) the app may use |

Only the folder's top-level files whose names do not begin with a dot are placed in an app;
subfolders are not.

## The layer line

`theme.css`'s first statement, before any comment, is

```css
@layer ui-sdk, structure, <name>;
```

UI SDK injects its behaviour CSS into the `ui-sdk` layer at runtime and `structure.css`
begins `@layer ui-sdk, structure;`, so the order holds whichever file is inlined first. Do not
also load UI SDK's own `web.css`: a theme replaces it, which is why a theme draws every icon
(chevrons, checks, the X) itself.

## What a theme must style

`contract.json` lists 21 components. Each slot is a `[data-slot="…"]` element with the
states a theme must give a rule (`:hover`, `[data-disabled]`, `[data-open]` and the like).
Where a slot has duties, `structure` says what `structure.css` already does for it and
`theme` says what is yours: a size, an icon to draw, a row to lay out. A slot marked
`hidden` or `optional` needs no rule. `facts` holds the rules no slot carries: popup
placement is UI SDK's, never a theme's to move, and variants are the attributes an author
sets (`data-variant`, `data-size`).

`variables` lists every `--theme-*` custom property `structure.css` reads, with its default
and purpose: dialog width and height, the field and label gaps, the toast width and gap, and
`--theme-toast-y`, which a theme may set to make collapsed toasts peek out or to slide one in.
Set the sizes on `:root` in your layer, and `--theme-toast-y` on the toast itself.

## Look, then check

Run `bun install` in this folder once. Then:

- `bun sample.ts --theme <name or path>` serves one page with every contract component in
  every state under your theme. Look at it at a desktop and a phone width.
- `bun check.ts <name or path>` lists, one per line, every required slot or state no rule
  selects, a wrong folder name or layer line, a non-`data:` URL and a missing file. It exits
  0 when there is nothing to report. It measures no colour: contrast is for your eyes on the
  sample page, and your README says where the theme falls short.

A name is a folder beside this file; a path is your own theme anywhere.

## The worked example

`pouf/` is the first theme: its `theme.css` styles every slot, its `README.md` shows how an
app loads the files and lists its tokens and variants, and `kit.tsx` is an example of layout
components.
