# Changelog

Notable changes to `dsh-better-setting-page`.

Two version numbers exist in this project and they are not the same thing:

- `package.json` `version` — the npm/GitHub release version.
- the stored settings `version` — moves only when the shape of the saved record
  changes. This release ships shape `1`.

## 0.1.9 — 2026-11-17

**Packaging only: `engines.dsh`.** This release adds
`"engines": { "dsh": ">=0.2.2-rc.1 <0.3.0-0" }` so the host — and any directory
that lists the plugin — can check up front that a compatible DSH is installed.
Nothing else changed: no behaviour, no layout, no motion, no settings. If you
already run 0.1.8, installing 0.1.9 looks and acts exactly the same.

## 0.1.8 — 2026-11-17

Every plugin's settings page now gets the content entrance — the host's own
sections included, not only the one the host happens to open first — and the
animation switch now says why it does nothing when the system asks for reduced
motion, instead of reading "on" while everything stands still.

The generic content rule was gated on `[data-bsp-phase="open"]`, and the host
lands on its first section — so switching to any other page (the host's own or
another plugin's) mounted fresh content under no matching phase and animated
nothing. The rule now hangs off `data-bsp-motion` alone: one level (direct
children of `[data-slot="settings.section"]`), one 90ms delay. There is no
per-row staircase on foreign pages, because that would mean guessing at markup
this plugin does not own.

Both override blocks still carried the phase selector and would have lied once
the rule was un-gated: window mode (no stagger inside a small dialog) and
`prefers-reduced-motion` (no animation at all) now match the same selector with
the same specificity, later in the file, so the cascade settles it without
`!important`.

### Added

- Three regression groups (61 → 64): the generic rule is mount-gated and one
  level deep, both overrides neutralise it, and our own page keeps its
  90 / 126 / 162 / 198ms staircase without doubling.
- The motion row now explains itself: when the system reports
  `prefers-reduced-motion: reduce`, a small note under "Settings page
  open/close animation" says the animation will not play. The switch stays
  usable — without the note, "switch on + system asks for less motion" looked
  like a control that did nothing (64 → 65 checks, one group added for this).

## 0.1.7 — 2026-11-17

The settings page now opens and closes with the motion that was designed and
measured back in task-64 but never shipped: a short staggered entrance for the
content and a faster fade for the close. Both are opt-out, and both disappear
entirely when the system asks for reduced motion.

The host unmounts the whole portal synchronously when the page closes, with no
intermediate state to animate. The close animation is therefore played on the
**same node object** after it has left the tree: a `MutationObserver` catches the
removed node, re-appends it for one animation, and drops it. The node is never
cloned — a clone would lose the rendered state and come back blank.

### Added

- Open animation: panel fades in over 170ms while the title (30ms), rail (40ms),
  header (60ms) and content rows (90 / 126 / 162 / 198ms) follow in a 458ms
  window. Window mode gets a 260ms rise instead of the stagger.
- Close animation: 150ms (full-screen) / 160ms (window) fade-and-lift on the
  ousted node, with an 800ms timer as the safety net.
- `motion` setting (default `true`) and a "Settings page open/close animation"
  switch on our own page. Stored shape stays `1`.

### Notes

- `prefers-reduced-motion: reduce` disables every animation and skips the ousted
  ghost entirely. The override is written last with the same selectors as the
  animated rules, so the cascade settles it without a force flag — this project
  still contains no `!important`.
- Nothing names a host class: the host uses CSS-Modules hashed names and no
  wrapper id. Every rule keys off `data-shortcut-modal="settings"` plus the
  structural anchors (`> nav`, the `:has()` lookups for mask / title / action row,
  and `[data-slot="settings.section"] > *`).

## 0.1.6 — 2026-11-15

Undoes the stand-down introduced in 0.1.5. **UI Controller 0.2.0 no longer manages
the settings-page rail** — its three-state toggle (expanded / rail / hidden) was
removed on request, so from that release on nothing on that side drove
`grid-template-columns` any more. The 0.1.5 contract therefore left the rail owned
by nobody: this plugin disabled its own switch and pointed at a feature the other
plugin had already deleted.

The symptom was only visible in a profile that had both plugins installed; a
profile without the UIC kept working, which is why it looked like a version
difference between two builds. It was not — both instances shipped the same 0.1.5
file.

### Changed

- Removed the stand-down: `uicPresenceOf()`, `UIC_SECTION_ID` and `UIC_PANEL_ATTR`
  are gone, and the five collapse rules no longer carry a
  `:not([data-uic-nav])` guard.
- **Collapse the section list by default** is usable again in every profile. It is
  no longer disabled, and its hint is back to "shrinks the rail to a 56px icon
  column…" instead of pointing at the UIC.
- The header chevron is always rendered; `data-bsp-nav` is always written.
- The i18n key `page.navCollapsedManaged` is removed from both dictionaries.

### Notes

- Stored record shape is untouched; `settings.version` stays `1`.
- If a UI Controller build still stamps `data-uic-nav`, it is now simply ignored.

## 0.1.5 — 2026-11-14

The rail now yields to the [UI Controller](https://github.com/MeruSu/dsh-ui-controller) plugin. With the UIC installed, two plugins were fighting over the same `grid-template-columns` declaration: the UIC deliberately leaves `expanded` to the host's own width, while this plugin's collapsed rule kept winning at 56px — so "expanded" rendered as a 56px rail.

### Changed
- `uicPresenceOf(ctx)` now reads the section registry (`settings.section` entries containing the `ui-controller` id), not the mounted panel — correct before the dialog has ever opened.
- While the UIC is present, this plugin no longer writes `data-bsp-nav`, its collapse styles are guarded off the panel (`:not([data-uic-nav])`), the header chevron is not rendered, and the "Collapse the section list" switch is disabled with a "managed by the UIC" hint.
- Without the UIC, behaviour is unchanged.

### Notes
- Stored record shape is untouched; `settings.version` stays `1`.

## 0.1.4 — 2026-11-14

Settings pages can be hidden from the rail without being uninstalled, and every
hidden page stays reachable from **Settings → Settings page**.

### Added

- A **hidden pages** list on this plugin's own settings page. The list comes from
  the slot registry (`ctx.slots.entries("settings.section")`), not from the DOM:
  at cold start the rail is not mounted, so a DOM-driven list would come back
  empty and overwrite the user's choices with nothing.
- Per-row **hide / restore**. The row of a hidden page stays in the list and
  stays clickable; clicking it opens that page. Hiding is not a one-way door, and
  that is the whole point of the feature.
- `sanitizeHidden()`: strings only, trimmed, deduplicated, empty string and this
  page's own id dropped, capped at `HIDDEN_MAX` (64).
- Opening goes through the shell store (`openSection`) and then polls
  `aria-current` for ~320 ms (`OPEN_ATTEMPTS` 8 × `OPEN_INTERVAL_MS` 40); when the
  store call does not land, the nav row is clicked directly. The store only sets
  `activeId` — it does not guarantee a render.
- 17 more unit checks (36 → 53), including the exact shape of the single hiding
  rule, an idempotent checkbox write, and the self-row staying read-only.

### Changed

- The stylesheet now contains exactly **one** `display: none` rule, scoped to
  `nav [data-bsp-hidden="1"]:not([aria-current="true"])`. It exists because
  hiding a nav row *is* the feature; the mask, the close button and page bodies
  remain untouchable, and two unit checks that used to assert "no `display: none`
  anywhere" now assert "exactly this one rule and nothing else".
- `:not([aria-current="true"])` keeps the row of the page you are on visible, so
  the rail still shows where you are after opening a hidden page.

Stored record gains `hidden: []`; `settings.version` stays `1`.

## 0.1.3 — 2026-11-14

Metadata release: the plugin now has a display name, a description and an icon
in the host's plugin list, instead of showing the bare package name.

### Added

- `locale/en.json` and `locale/zh.json` with `meta.title` / `meta.description`,
  and `icon.svg` declared as `package.json` `icon`. The host reads these without
  evaluating any JavaScript (`pluginPackages.metaOf`), so all three have to be
  reachable through `exports` and included in `files` — otherwise the published
  tarball lacks them and the list falls back to the package name.
- Three unit checks for exactly that: the manifest declares them, the icon is
  packaged and under the host's 256 KiB cap, and both languages carry a title and
  a description.

No code and no stored field changed; `settings.version` stays `1`.

## 0.1.2 — 2026-11-14

Layout-only release. No stored field changed, so `settings.version` stays `1`
and there is no migration.

### Fixed

- **The top-left toggle now stays top-left in every shell.** 0.1.1 flattened
  the two wrapper boxes so the toggle became a flex item of the header, but it
  still relied on being *registered* first. The browser build registers it
  first; the desktop shell registers the shipped actions first, so there the
  toggle landed to the *right* of "open config file". The toggle now carries
  `order: -1`, which pins it to the visual start regardless of DOM order. This
  was verified by swapping the two children in the live DOM and re-measuring:
  the toggle stayed at x `66` while the shipped action moved to x `1108`.

### Changed

- **The settings page content is centred.** In full screen the column is the
  whole window, so a capped page used to hug the left edge of a wide monitor.
  Pages inside `[data-slot="settings.section"]` now get `margin-inline: auto`
  next to the `max-width: 880px` cap: at a 1208px column the page lands at
  x `220` with equal 124px gutters, and the host's own pages (General settings)
  centre the same way.

### Note

- `client.js` is now pure LF. It had picked up CRLF line endings, which is what
  made a `node --check` diagnostic point at the wrong column earlier.

## 0.1.1 — 2026-11-14

Layout-only release: the header now reads left-to-right the way a settings page
is expected to. No stored field changed, so `settings.version` stays `1` and no
migration is involved.

### Changed

- **Collapse on the left, exit on the right.** The rail toggle moved from beside
  the shipped *Open config file* button to the top-left corner of the header, and
  the shipped close button now draws a **return arrow** instead of an ✕. The
  button itself is untouched — same node, same click handler, same accessible
  name from the host's `settings.close` slot, same `Esc` and click-outside paths.
- The toggle reaches the corner by flattening its two wrapper boxes with
  `display: contents` (`.actions` and the slot outlet), not by `order`: it is a
  grandchild of the header, so `order` could only reorder it inside `.actions`.
  One side effect is that the Tab order is now the visual order — toggle, then
  the shipped buttons, then the close button — without needing `reading-flow`.

### Added

- Three test groups (30 → **33**) covering the header layout: the flattening
  contract, that the close button is restyled rather than moved or replaced, and
  that the arrow is drawn as a mask. Mutating any of the three turns them red
  (verified by reverting each rule in turn).

### Verification

| Gate | Result |
|---|---|
| `node --check client.js` / `index.js` / `test/settings-page.test.mjs` | `0` / `0` / `0` |
| `node test/settings-page.test.mjs` | `PASS — 33 groups` |
| static gate (`261115_bsp_gate.mjs`) | `STATIC VERDICT: clean` |

Real-machine check on the **web** runtime (Harness `0.2.2-rc.1`, profile
`meru-test`, viewport 900×1323):

| Check | Result |
|---|---|
| Toggle sits at the header's left edge | **PASS** — x `66` collapsed (rail is 56px wide, first icon cell ends at 48), x `198` expanded (header starts at 188) |
| Close button stays at the right edge, arrow glyph | **PASS** — x `846` in both states, `svg` computed `visibility: hidden`, `::after` 14×14 mask |
| Tab order matches the visual order | **PASS** — `收起/展开分类栏@198 → 打开配置文件@744 → 关闭@846` |
| All three close paths still work | **PASS** — close button, `Esc`, mask click |
| Collapsed toggle does not cover the first icon | **PASS** — toggle `66–94`, first nav cell `8–48` |

### Notes

- The arrow is an inline SVG used as a `mask`, so it inherits `currentColor` and
  therefore the host theme (hover, dark mode) without a second copy of the glyph.
  A text `U+21A9` was rejected: it would depend on the font carrying the glyph.
- No `!important`, no `display: none` (the shipped glyph is `visibility: hidden`
  and absolutely positioned instead of removed), no new DOM node.

## 0.1.0 — 2026-11-14

First working release. `0.0.1` existed only to reserve the package name and did
nothing at runtime.

### Added

- **Full-window settings page.** The harness opens settings as an 800px modal;
  this release makes the panel fill the window (no radius, no drop shadow) and
  keeps the desktop title-bar height as top padding so the drag strip survives.
- **Collapsible section rail.** A chevron in the page header collapses the
  188px section list to a 56px icon column and back. The rail state is one
  attribute on `<html>`; collapsing is pure CSS — no host state is read or
  written.
- **Both choices remembered** in `localStorage` under
  `dsh.better-setting-page.settings` (`{ version, fullscreen, navCollapsed,
  unknown }`). Unrecognised keys are carried in `unknown` and written back, so a
  downgrade does not lose data.
- **Its own settings page** (Settings → Settings page): two switches and
  *Restore defaults*. Without it, a user who dislikes full screen would have to
  uninstall the plugin.

Full screen defaults to **on**, the rail to **expanded**; both are switchable.

### Notes on what was deliberately not done

- The mask is **not** hidden. The host attaches click-outside-to-close to it, so
  the plugin only strips its paint (`background: transparent;
  backdrop-filter: none`) and leaves the box and its `onClick` intact.
- No `!important`, no host hash class names, no writes to any host store.
- `html[data-fullscreen]` (the *window's* state) is never forced: doing so would
  also move where the host anchors its menus.

### Verification

Static gates, re-run by the maintainer on 2026-11-14:

| Gate | Result |
|---|---|
| `node --check client.js` / `index.js` / `test/settings-page.test.mjs` | `0` / `0` / `0` |
| `node test/settings-page.test.mjs` | `PASS — 30 groups` |
| static gate (`261115_bsp_gate.mjs`: undeclared constants + 9 required anchors + 5 forbidden patterns) | `STATIC VERDICT: clean` |

Real-machine check on the **web** runtime (Harness `0.2.2-rc.1`, profile
`meru-test`, viewport 1600×950), three of four items passing:

| Check | Result |
|---|---|
| Panel fills the window | **PASS** — panel rect `{ x: 0, y: 0, w: 1600, h: 950 }` equals the viewport; computed `grid-template-columns: "188px 1412px"` |
| Rail collapses | **PASS** — `188px 1412px` → `56px 1544px`; `html[data-bsp-nav="collapsed"]`; toggle reports `aria-expanded="false"`; the first real `Tab` press lands on the toggle |
| Choice survives reload, `Esc` and the close button still close | **PASS** |
| Desktop 40px title-bar drag strip | **not verified** — see below |

### Known limitations

- **The desktop 40px title-bar behaviour is unverified on a real Desktop app.**
  On the web runtime `html[data-windows-titlebar]="false"`,
  `--dsh-windows-titlebar-height` is unset and the computed padding is
  `max(0px, 0px)`, so the one thing this release cannot demonstrate is the thing
  it was written for. The drag strip is a `::before` overlay with
  `-webkit-app-region: drag`; the host's own frame uses the same technique, but
  that is reasoning, not a measurement. Treat it as **unverified** until a
  desktop run says otherwise.
- **This is not a window full-screen toggle.** It fills the window that exists.
- **Narrow windows keep the host layout.** Below 768px the harness turns the
  panel into a full-screen sheet on its own, so the collapse rules sit behind
  `@media (min-width: 768px)`.
- **Settings are per origin.** A different port is a different browser profile
  and the two switches reset there.
- **Anchor stability.** Everything hangs on `div[data-shortcut-modal="settings"]`
  and on the `settings.action` / `settings.section` slot names. If a future
  harness renames any of them the plugin stops taking effect — it does not
  crash, it just quietly does nothing.
