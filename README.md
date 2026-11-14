# Better Setting Page

Makes the DeepSeek Harness settings dialog a full-window page, and lets its
section rail collapse to a 56px icon column.

Settings in this harness open as an 800px-wide modal. That is fine for three
rows of switches and cramped for anything else — a category page with a card
per category is unreadable at that width, and the wasted screen is the user's.
This plugin does not add settings; it gives the page the room it should have had.

Verified against harness `0.2.2-rc.1` (`@deepseek-ai/dsh-client-ui-settings-general`
0.2.2-rc.1 in the unpacked asar) — see [How it works](#how-it-works) for the exact
anchors, so you can tell whether a later build still matches.

## Install

    dsh plugin --profile <profile> add dsh-better-setting-page

Restart that profile's window afterwards: the browser caches the old bundle.

## What you get

| | |
|---|---|
| Full-window page | The dialog fills the window; the panel radius and drop shadow go away. On desktop the title-bar height is kept as padding, and that strip still drags the window. |
| Collapsible rail | A chevron at the header's **left edge** collapses the section list to 56px of icons. Section names stay in the accessibility tree, so screen readers and `Tab` still announce them. |
| Remembered in this browser | Both switches live in this browser profile's `localStorage`, key `dsh.better-setting-page.settings`. |
| Its own settings page | Under **Settings → Settings page** you get two switches and **Restore defaults**. Without that page, a user who dislikes full screen would have to uninstall the plugin. |

Full screen is **on by default**; the rail is **expanded by default**. Both are
switchable, and both choices survive a restart.

The header reads the way a settings page is expected to: **collapse on the left,
exit on the right**. The close button in that corner draws a **return arrow**
instead of an ✕. It is still the host's own button — same node, same handler,
same accessible name — so nothing about closing changed, only the glyph.

Closing works exactly as it did before: `Esc`, the close button, and a click on
the mask. The mask is still there and still clickable — with full screen on it is
simply covered by the panel, so in practice `Esc` and the close button are what
you reach for.

The rail is collapsed by CSS only; the section names are visually hidden, not
removed, so `Tab` still lands on each entry and a screen reader still announces
it. There is no hover-to-expand: the arrow toggles, nothing else moves.

## How it works

Everything hangs off two attributes this plugin owns on `<html>`:

    <html data-bsp-fullscreen="on" data-bsp-nav="collapsed">

One stylesheet reads them. No `MutationObserver`, no re-render on the host's
React tree, no writes to any host store. The host may mount, unmount and
remount the settings panel at will; the state is already on the root element.

Three things about the shipped DOM are worth knowing before you write a similar
patch.

**1. `[data-slot="…"]` is a renderer anchor, not a container.** The renderer's
`SlotOutlet` emits it with `style: { display: "contents" }`, so the element
generates no box: its children take part in the *grandparent's* layout. It also
sits inside `.actions` / `.options`, never directly under `.header`. So:

    /* correct: match the header row by descendant */
    div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"])
    /* wrong, silently matches .actions: */
    div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.action"])

**2. The mask owns click-outside-to-close.** `div.mask` carries `onClick={onClose}`.
`display: none` or `pointer-events: none` on it does not "clean up the overlay",
it deletes a feature with no error. This plugin only strips the mask's *paint*
(`background: transparent; backdrop-filter: none`) and leaves its box alone.

**3. The grid area names are CSS-Modules hashes.** Override only the
`grid-template-columns` longhand. Rewriting the `grid-template` shorthand would
also reset `"title header" / "nav options"` and collapse the layout.

There is no `!important` and no host class name in the stylesheet: every rule is
anchored on `div[data-shortcut-modal="settings"]`, which is a stable data
attribute and already more specific (0,1,1) than the shipped module classes
(0,1,0).

## Switches

| Field | Default | Meaning |
|---|---|---|
| `fullscreen` | `true` | Fill the window instead of 800px. |
| `navCollapsed` | `false` | Collapse the section rail to icons. |

Stored shape:

```json
{ "version": 1, "fullscreen": true, "navCollapsed": false, "unknown": {} }
```

Keys this version does not recognise are carried in `unknown` and written back,
so a downgrade or a newer build does not lose data. A malformed record falls
back to defaults instead of throwing.

## Limits

- **Not a full-screen window.** `html[data-fullscreen]` is the *window's* state,
  not this plugin's; forcing it would also change where the host anchors its
  menus. This page fills the window that exists.
- **Desktop only for the drag strip — and not yet verified there.** On the web
  runtime there is no title bar (`--dsh-frame-top-clearance` is unset), so the
  computed padding is `max(0px, 0px)`: the plugin adds no strip and no drag
  region, which means the one thing this release cannot demonstrate is the thing
  the strip exists for. Until a real Desktop app run says otherwise, treat the
  40px drag area as **unverified**.
- **Narrow windows keep the host layout.** Below 768px the harness turns the
  panel into a full-screen sheet on its own; collapsing to 56px there would
  leave nothing, so the collapse rule is behind `@media (min-width: 768px)`.
- **Settings are per origin.** A different port is a different profile: your two
  switches reset there.

## Files

    client.js            browser half: stylesheet, rail toggle, settings page
    index.js             host half: exists so the bundle resolves, injects nothing
    cordis.patch.yml     bundle patch
    test/settings-page.test.mjs   33 checks, no dependencies

## Tests

    node --check client.js
    node --check index.js
    node test/settings-page.test.mjs     # → PASS — 33 groups

The test executes the real `client.js` with a stubbed `window.__ModuleLoader__`
and asserts on the exported strings and store, including two regression traps:
one fails if the header selector is ever "simplified" back to a direct child,
the other fails if the full-screen rules stop being gated on this plugin's own
attribute. Whether the page really fills the window is a machine check, not a
unit test.

On the web runtime (Harness `0.2.2-rc.1`, 1600×950) that machine check was run
and three of four items passed: the panel rect equals the viewport
(`{0,0,1600,950}`), the rail goes `188px 1412px` → `56px 1544px` with
`aria-expanded="false"`, and the choice survives a reload while `Esc` and the
close button still close. The fourth — the desktop 40px title-bar drag strip —
**was not verified**: see [Limits](#limits).

The header layout was measured again for 0.1.1 at 900×1323: the toggle sits at
x `66` collapsed and `198` expanded (the rail is 56px, so it never covers the
first icon), the close button stays at x `846` in both states with its glyph
hidden and a 14×14 arrow mask on top, and the `Tab` order is
`toggle → Open config file → close`, i.e. left to right.

## License

MIT
