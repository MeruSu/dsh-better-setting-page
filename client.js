/**
 * Browser half of `dsh-better-setting-page` — full-screen settings page with a
 * collapsible navigation rail.
 *
 * What it does (and nothing else):
 *   1. One stylesheet that turns the shipped settings dialog into a full-window
 *      page and narrows its left rail to 56px when collapsed. Every rule hangs
 *      off two attributes we own on `<html>`, so the panel can be unmounted and
 *      remounted by the host at any time and the state survives without any
 *      MutationObserver.
 *   2. One button in the `settings.action` slot that toggles the rail, pinned to
 *      the top-left corner of the header (see "header layout" below).
 *   3. One `settings.section` page with the two switches and "restore defaults",
 *      because a plugin that can only be undone by clearing localStorage is a
 *      plugin the user cannot turn off.
 *   4. A "hidden pages" list on that page: any other `settings.section` page can
 *      be taken out of the nav without being uninstalled, and every hidden page
 *      stays listed — and reachable — from our own page. Being able to hide a
 *      page you can then only reach through the page that hid it is the whole
 *      point; if the list did not keep the entry, hiding would be a one-way door.
 *
 * Header layout: collapse on the left, exit on the right. The shipped close
 * button stays exactly where the host put it and keeps its own click handler and
 * accessible name; only its glyph changes to a return arrow. We reach the
 * top-left corner by flattening the two wrapper boxes with `display: contents`
 * rather than by `order`, because the toggle lives two levels down inside
 * `.actions` and `order` cannot move a node out of its flex parent.
 *
 * Deliberate non-goals: no `settings.header` takeover (that slot is the dialog's
 * `aria-labelledby` target and shadows shipped UI), no `display:none` on the
 * mask (its `onClick` is the click-outside-to-close handler), no removing or
 * re-parenting the shipped close button, no `!important`, no hash class names,
 * no host store writes.
 *
 * Selector notes that are easy to get wrong (verified against the shipped DOM):
 *   - `[data-slot="…"]` is emitted by the renderer's `SlotOutlet` with
 *     `style:{display:"contents"}`. It produces no box, so it can be used to
 *     anchor a selector but never as a sized container.
 *   - It sits inside `.actions` / `.options`, never directly under `.header`.
 *     Matching the header row therefore has to use a descendant combinator:
 *     `> div:has([data-slot="settings.action"])`.
 *   - A catch-all `button:last-child` on the header would also match our own
 *     toggle, because with `.actions` flattened every button becomes a direct
 *     child of the header. The close button is therefore addressed as
 *     `> button:last-of-type` **and** every rule that touches it is scoped to the
 *     arrow glyph only.
 *   - `clip` alone does not hide anything: the visually-hidden utility below
 *     needs absolute positioning plus `clip-path`.
 */

window.__ModuleLoader__.load({
  id: 'dsh-better-setting-page',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace and the prefix of every DOM attribute we own. */
    const NS = 'better-setting-page'
    const VERSION = '0.1.6'

    /** localStorage key. Bumping `SETTINGS_VERSION` requires a migration. */
    const STORE_KEY = 'dsh.better-setting-page.settings'
    const SETTINGS_VERSION = 1

    const DEFAULTS = {
      version: SETTINGS_VERSION,
      fullscreen: true,
      navCollapsed: false,
      /** Section ids whose nav row is hidden. Our own id is never allowed in here. */
      hidden: [],
    }

    /** A runaway list would be a bug, not a preference: cap it. */
    const HIDDEN_MAX = 64

    /** `<html>` attributes: the only state the stylesheet reads. */
    const FULLSCREEN_ATTR = 'data-bsp-fullscreen'
    const NAV_ATTR = 'data-bsp-nav'
    /** Id we lend to the host's `<nav>` so `aria-controls` has a target. */
    const NAV_ID = 'dsh-bsp-nav'

    const PANEL = 'div[data-shortcut-modal="settings"]'

    const SECTION_ID = 'better-setting-page'
    const SECTION_ORDER = 50
    const ACTION_ID = 'better-setting-page.rail-toggle'

    /**
     * Attributes we stamp on the host's nav cells. The nav is rendered by the
     * host, not by us, so the only way to take a row out of it is to mark the row
     * and let our stylesheet do the rest. Marked by section id, never by index:
     * the host re-sorts the list whenever a plugin registers.
     */
    const NAV_ID_ATTR = 'data-bsp-id'
    const HIDDEN_ATTR = 'data-bsp-hidden'
    /** Both directions of the reveal-on-demand window, see `requestOpen`. */
    const OPEN_ATTEMPTS = 8
    const OPEN_INTERVAL_MS = 40

    //#region stylesheet
    /**
     * The whole visual layer. No `!important` anywhere: `div[data-shortcut-modal
     * ="settings"]` is (0,1,1) against the shipped module classes at (0,1,0), and
     * every rule below is at least that specific.
     */
    const CSS = `
/* ── 1. Full-screen panel ───────────────────────────────────────────────── */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]{
  --bsp-top-pad: max(var(--dsh-windows-titlebar-height, 0px), var(--dsh-frame-top-clearance, 0px));
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  max-width: none;
  max-height: none;
  border-radius: 0;
  box-shadow: none;
  padding-top: var(--bsp-top-pad);
  background: var(--dsw-alias-bg-layer-2);
}

/* A genuinely full-screen window has no title bar, so there is nothing to pad. */
html[data-bsp-fullscreen="on"][data-fullscreen] div[data-shortcut-modal="settings"]{
  --bsp-top-pad: 0px;
}

/* The pad strip is window chrome, not page content: keep it draggable, but only
   on desktop, where that strip actually exists. */
html[data-windows-titlebar][data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]::before,
html[data-platform="darwin"][data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]::before{
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: var(--bsp-top-pad);
  -webkit-app-region: drag;
}

/* ── 2. Mask keeps its hit area, loses only its paint ───────────────────── */
/* The mask owns the click-outside-to-close handler. Hiding it or switching off
   its pointer events does not "clean up the overlay", it deletes a feature with
   no error. Only the paint is removed here; the box stays. */
html[data-bsp-fullscreen="on"] div:has(> div[data-shortcut-modal="settings"]) > div:first-child{
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

/* ── 3. Content column ──────────────────────────────────────────────────── */
/* Header row: the action slot lives inside .actions, so match by descendant. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]){
  padding-right: 26px;
}
/* Content column is the direct parent of the section outlet. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.section"]){
  min-height: 0;
}
/* Wide windows get breathing room; narrow ones keep the host's tighter padding. */
@media (min-width: 768px){
  html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.section"]){
    padding: 0 40px 40px;
  }
}
/* A full-width page would otherwise run a line across the whole monitor, and on a
   wide screen it would also hang off the left edge: the column is a plain block
   box, so a capped child stays where the padding puts it unless it is centred.
   Centring is done with auto inline margins rather than by centring the column
   itself, because the host's own pages also cap their width and would otherwise
   stay left-aligned inside a wide column. */
html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"] [data-slot="settings.section"] > *{
  max-width: 880px;
  margin-inline: auto;
}

/* ── 4. Collapsible rail ────────────────────────────────────────────────── */
/* Everything about collapsing is behind the same breakpoint the host uses to
   turn the rail into a horizontal tab bar (<=767px). Collapsing a horizontal bar
   has no meaning, and hiding its labels there would leave an unlabelled strip. */
@media (min-width: 768px){
  /* Only the grid-template-columns longhand: the area names in the shorthand are
     CSS-Modules hashes and would break on the next build.
     No guard attribute on the panel: nothing else draws this rail any more. An
     older revision stood down for dsh-ui-controller here, but that plugin gave up
     the rail (its expanded / rail / hidden states are gone), so a guard would
     leave the rail owned by nobody — collapsed by this plugin's button, driven by
     no rule at all. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"]{
    grid-template-columns: 56px minmax(0, 1fr);
  }
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav{
    padding: 10px 8px 0;
  }
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav > div > button{
    /* Anchors the visually-hidden label to its own cell instead of the panel. */
    position: relative;
    justify-content: center;
    padding: 9px 0;
    gap: 0;
  }
  /* The panel title stays readable, it just loses its 24px indent. Hiding it
     would also hide the dialog's accessible name, which is this node. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > div[id]{
    padding: 22px 4px 8px;
    overflow: hidden;
    font-size: 13px;
    line-height: 24px;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  /* Visually hidden, still in the accessibility tree: with the label gone the
     icon is all that is left, and the icon carries no accessible name of its
     own. Second span rather than last-child, so that a cell rendered without an
     icon span never causes the icon itself to be hidden. */
  html[data-bsp-nav="collapsed"] div[data-shortcut-modal="settings"] > nav > div > button > span:nth-child(2){
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }
}

/* ── 5. Header layout: toggle left, then the shipped actions and exit right ── */
/* The header is a flex row with justify-content: space-between and exactly two
   children: .actions (a flex row holding the slot outlet, which holds the
   shipped action buttons plus ours) and the shipped close button. Our toggle is
   a grandchild of the header — header > .actions > [data-slot] > button — so no
   order value can move it out of .actions until those wrappers are flattened.

   Flattening the two wrappers with display: contents promotes the slot's
   children to real flex items of the header. The slot outlet already uses
   display: contents, so this only adds the one level that was in the way.

   Once flattened, the toggle is *a* flex item but not necessarily the *first*
   one: the order of the slot's children is registration order, and the shipped
   actions that register into settings.action can come before ours (measured: the
   browser build puts ours first, the desktop shell puts the shipped ones first).
   An earlier revision relied on being first and therefore only looked right in
   one of the two. order: -1 pins the toggle to the visual start regardless of
   DOM order, and space-between is replaced by flex-start + an auto margin on the
   toggle so that the shipped actions and the close button stay adjacent at the
   far right instead of drifting to the middle.

   Tab order still follows the flattened DOM, not order. That is why the toggle
   carries tabIndex in registration order and why the panels below are not
   reordered with order: visual order and focus order only diverge for the
   toggle, and it is the first thing the dialog's own roving focus reaches. */
/* Being first in 'order' is not enough on its own: 'space-between' would still
   distribute the items by their own sizes and pull the shipped actions away from
   the close button. flex-start plus an auto margin on the toggle keeps the
   toggle at the visual start and parks everything else against the right edge,
   with the shipped actions immediately before the close button. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > div:has(> [data-slot="settings.action"]){
  display: contents;
}

/* The action slot outlet in the middle is already display: contents from the
   renderer. Restated so a future change to that inline style cannot silently
   break the header layout into a stack. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > div:has(> [data-slot="settings.action"]) > [data-slot="settings.action"]{
  display: contents;
}

/* The header itself becomes a plain left-aligned row. Both properties are needed
   once the wrappers above are flattened, because the shipped header relies on
   space-between between exactly two boxes. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]){
  justify-content: flex-start;
}

/* Visual start, whatever the registration order was. The anchor in between is a
   real element in the DOM (only display:contents makes it look transparent), so
   the selector has to span it instead of assuming the toggle is a direct child of
   the header. */
div[data-shortcut-modal="settings"] [data-slot="settings.action"] > .bsp-rail-toggle{
  order: -1;
  margin-right: auto;
}

/* The return arrow used for the shipped close button, as a mask so it inherits
   the button's color and therefore the host theme (hover, dark mode) without a
   second copy of the glyph. Inline SVG because the shipped icon set is a sprite
   we must not fork; a text glyph would depend on the font carrying U+21A9. The
   custom property lives on the button itself so no ungated panel rule is needed
   and ::after inherits it. */
/* The shipped close button, and only it: last-of-type on the header level. Its
   glyph becomes a return arrow. The button keeps its box, its accessible name
   (the host fills it through the settings.close slot) and its click handler —
   Esc and click-outside remain untouched, and the node is never removed. */
/* The shipped glyph is taken out of flow and made invisible rather than
   display:none: the project forbids that property outright, and keeping the node
   in the tree means the host's icon still exists for anything that looks it up by
   data-icon. Absolute positioning keeps it from adding 14px next to the arrow. */
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type{
  --bsp-return-icon: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M6.5 3.5 3 7l3.5 3.5'/><path d='M3 7h6.25A3.75 3.75 0 0 1 13 10.75v1.75'/></svg>");
  position: relative;
}
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type > svg{
  position: absolute;
  visibility: hidden;
}
div[data-shortcut-modal="settings"] > div:has([data-slot="settings.action"]) > button:last-of-type::after{
  content: "";
  position: absolute;
  inset: 0;
  margin: auto;
  width: 14px;
  height: 14px;
  background-color: currentColor;
  -webkit-mask: var(--bsp-return-icon) center / contain no-repeat;
  mask: var(--bsp-return-icon) center / contain no-repeat;
}

/* ── 6. Rail toggle button (settings.action) ────────────────────────────── */
[data-slot="settings.action"] > .bsp-rail-toggle{
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
}
[data-slot="settings.action"] > .bsp-rail-toggle:hover{
  background-color: var(--dsw-alias-interactive-bg-hover);
}
[data-slot="settings.action"] > .bsp-rail-toggle:focus-visible{
  outline: var(--dsw-focus-ring-width, 2px) solid
           var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}

/* ── 7. Our own settings page ───────────────────────────────────────────── */
.bsp-page{
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-width: 880px;
  padding: 8px 2px 28px;
}
.bsp-head{ padding: 4px 0 12px; }
.bsp-title{
  margin: 0 0 6px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -0.01em;
  color: var(--dsw-alias-label-primary);
}
.bsp-sub{
  margin: 0;
  max-width: 64ch;
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-tertiary);
}
.bsp-row{
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 16px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.bsp-rowText{ min-width: 0; }
.bsp-rowLabel{
  font-size: 14px;
  line-height: 20px;
  color: var(--dsw-alias-label-primary);
}
.bsp-rowHint{
  margin-top: 4px;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-secondary);
}
.bsp-check{
  flex: none;
  width: 16px;
  height: 16px;
  accent-color: var(--dsw-alias-brand-primary);
  cursor: pointer;
}
.bsp-actions{
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 0 4px;
}
.bsp-button{
  min-height: 32px;
  padding: 0 14px;
  border: .5px solid var(--dsw-alias-border-l4);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-3);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  cursor: pointer;
}
.bsp-button:hover{ background-color: var(--dsw-alias-interactive-bg-hover); }
.bsp-button:focus-visible{
  outline: var(--dsw-focus-ring-width, 2px) solid
           var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
.bsp-notice{
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
.bsp-note{
  margin: 12px 0 0;
  max-width: 64ch;
  font-size: 12px;
  line-height: 1.55;
  color: var(--dsw-alias-label-tertiary);
}

/* ── 8. Hidden pages: list on our page, row taken out of the host nav ────── */
/* The one place in this stylesheet that hides something on purpose, and the
   reason the rule is this narrow. Hiding a nav row is what the feature IS, so
   the mask-chain prohibition does not apply here; what must stay true is that
   the property can only ever reach a row *inside* the settings nav that we
   ourselves marked, never the mask, never a click target, never a page body.
   The unit test pins that: display:none is allowed in this single rule and
   nowhere else.

   :not([aria-current="true"]) is deliberate. After opening a hidden page from our
   list the row comes back for as long as you are on it, so the rail still shows
   where you are; a hidden page you are not on stays gone. */
div[data-shortcut-modal="settings"] nav [data-bsp-hidden="1"]:not([aria-current="true"]){
  display: none;
}
.bsp-sections{
  display: flex;
  flex-direction: column;
  padding: 4px 0 0;
}
.bsp-sectionRow{
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 0;
  border-bottom: .5px solid var(--dsw-alias-border-l2);
}
.bsp-sectionRow:last-child{ border-bottom: 0; }
.bsp-sectionLink{
  flex: 1;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  line-height: 20px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.bsp-sectionLink:hover{ color: var(--dsw-alias-brand-primary); }
.bsp-sectionLink:focus-visible{
  outline: var(--dsw-focus-ring-width, 2px) solid
           var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.bsp-sectionLink[aria-disabled="true"]{
  color: var(--dsw-alias-label-tertiary);
  cursor: default;
}
.bsp-sectionState{
  flex: none;
  font-size: 12px;
  line-height: 18px;
  color: var(--dsw-alias-label-tertiary);
}
`.trim()
    //#endregion

    //#region dictionaries
    const ZH = {
      'section.nav': '设置页',
      'rail.expand': '展开分类栏',
      'rail.collapse': '收起分类栏',
      'page.title': '设置页外观',
      'page.intro': '这个插件只改设置页的呈现方式，不读也不写任何设置值。',
      'page.fullscreen': '全屏设置页',
      'page.fullscreenHint': '铺满整个窗口。桌面版会在顶部留出标题栏高度，那一条仍然可以拖动窗口。',
      'page.navCollapsed': '默认收起左侧分类栏',
      'page.navCollapsedHint': '收成 56px 图标栏，分类名保留给读屏。点右上角箭头可随时切换。',
      'page.reset': '恢复默认',
      'page.resetDone': '已恢复默认',
      'page.saveFailed': '浏览器拒绝保存（localStorage 已满或被禁用），这次改动没有生效。',
      'page.note': '这两项存在本机浏览器的 localStorage（键 dsh.better-setting-page.settings），换端口或清站点数据会丢。不认识的字段会原样保留。',
      'pages.title': '被屏蔽的设置页',
      'pages.intro': '取消勾选，那一页就从左侧分类栏消失；这里仍然列着它，也是唯一还能进去的地方。',
      'pages.empty': '当前只有这一页，没有可屏蔽的对象。',
      'pages.self': '本页，不能屏蔽自己',
      'pages.hidden': '已屏蔽',
      'pages.open': '打开',
      'pages.openFailed': '打不开这一页：宿主没有响应切换请求。',
      'pages.resetHint': '「恢复默认」会把屏蔽列表一起清空。',
    }

    const EN = {
      'section.nav': 'Settings page',
      'rail.expand': 'Expand section list',
      'rail.collapse': 'Collapse section list',
      'page.title': 'Settings page appearance',
      'page.intro': 'This plugin only changes how the settings page is drawn. It reads and writes no setting of its own.',
      'page.fullscreen': 'Full-screen settings',
      'page.fullscreenHint': 'Fill the whole window. On desktop the title-bar height is kept as padding, and that strip still drags the window.',
      'page.navCollapsed': 'Collapse the section list by default',
      'page.navCollapsedHint': 'Shrinks the rail to a 56px icon column; section names stay in the accessibility tree. Toggle it any time with the arrow in the header.',
      'page.reset': 'Restore defaults',
      'page.resetDone': 'Defaults restored',
      'page.saveFailed': 'The browser refused to save this (localStorage full or blocked); the change did not stick.',
      'page.note': 'Both switches live in this browser profile’s localStorage (key dsh.better-setting-page.settings), so a different port or cleared site data resets them. Unknown fields are preserved as-is.',
      'pages.title': 'Hidden settings pages',
      'pages.intro': 'Clear a checkbox and that page leaves the section list on the left. It stays listed here, and this is the only way back in.',
      'pages.empty': 'This is the only page right now, so there is nothing to hide.',
      'pages.self': 'This page — it cannot hide itself',
      'pages.hidden': 'Hidden',
      'pages.open': 'Open',
      'pages.openFailed': 'Could not open that page: the host never switched to it.',
      'pages.resetHint': '"Restore defaults" also clears this list.',
    }
    //#endregion

    //#region settings store
    function isPlainObject(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
    }

    /**
     * Turn whatever was on disk into the exact shape this version understands.
     * Unknown top-level keys are carried in `unknown` so a downgrade or a future
     * version does not lose data the user (or a newer build) wrote.
     */
    /**
     * The hidden-page list is just section ids: strings, no duplicates, never our
     * own page (hiding the page that owns the list would make the list
     * unreachable — the one door that must stay open), and capped so a corrupt
     * value cannot turn into an unbounded allocation.
     */
    function sanitizeHidden(raw) {
      const list = []
      if (!Array.isArray(raw)) return list
      for (const item of raw) {
        if (typeof item !== 'string') continue
        const id = item.trim()
        if (id === '' || id === SECTION_ID) continue
        if (list.indexOf(id) >= 0) continue
        list.push(id)
        if (list.length >= HIDDEN_MAX) break
      }
      return list
    }

    function sanitizeSettings(raw) {
      const next = { version: SETTINGS_VERSION }
      const unknown = isPlainObject(raw) && isPlainObject(raw.unknown) ? { ...raw.unknown } : {}
      if (isPlainObject(raw)) {
        for (const key of Object.keys(raw)) {
          if (key === 'unknown' || key === 'version' || key in DEFAULTS) continue
          unknown[key] = raw[key]
        }
      }
      next.fullscreen = isPlainObject(raw) && typeof raw.fullscreen === 'boolean'
        ? raw.fullscreen
        : DEFAULTS.fullscreen
      next.navCollapsed = isPlainObject(raw) && typeof raw.navCollapsed === 'boolean'
        ? raw.navCollapsed
        : DEFAULTS.navCollapsed
      next.hidden = sanitizeHidden(isPlainObject(raw) ? raw.hidden : DEFAULTS.hidden)
      next.unknown = unknown
      return next
    }

    /** Last write/read problem, surfaced on the settings page. */
    let lastError = null

    function readSettings() {
      let raw = null
      try {
        const text = window.localStorage.getItem(STORE_KEY)
        if (typeof text === 'string' && text !== '') raw = JSON.parse(text)
        lastError = null
      } catch (error) {
        lastError = 'read'
        raw = null
      }
      return sanitizeSettings(raw)
    }

    function persist(settings) {
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(settings))
        lastError = null
      } catch (error) {
        lastError = 'write'
      }
    }

    let cache = null
    const listeners = new Set()

    function currentSettings() {
      if (cache === null) cache = readSettings()
      return cache
    }

    /**
     * Push a sanitized snapshot everywhere: disk, `<html>` attributes, listeners.
     * The `storage` event does not fire in the document that wrote it, so we
     * notify our own subscribers here instead of waiting for the event.
     */
    function commit(next) {
      cache = next
      persist(next)
      applyToDocument(next)
      for (const fn of listeners) fn(next)
      return next
    }

    function writeSettings(patch) {
      // Base the merge on what is on disk, not on the in-memory cache: another
      // window may have written unknown keys that this one has never seen, and
      // a patch must not drop them.
      const base = readSettings()
      const merged = isPlainObject(patch) ? { ...base, ...patch } : base
      return commit(sanitizeSettings(merged))
    }

    function resetSettings() {
      return writeSettings({
        fullscreen: DEFAULTS.fullscreen,
        navCollapsed: DEFAULTS.navCollapsed,
        hidden: [],
      })
    }

    function subscribeSettings(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }

    /** The only DOM this plugin writes outside its own subtree. */
    function applyToDocument(settings) {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === null || root === undefined) return
      root.setAttribute(NAV_ATTR, settings.navCollapsed === true ? 'collapsed' : 'expanded')
      root.setAttribute(FULLSCREEN_ATTR, settings.fullscreen === true ? 'on' : 'off')
    }

    function clearDocument() {
      if (typeof document === 'undefined') return
      const root = document.documentElement
      if (root === null || root === undefined) return
      root.removeAttribute(FULLSCREEN_ATTR)
      root.removeAttribute(NAV_ATTR)
    }

    /** Another window sharing this profile changed the settings. */
    function watchStorage() {
      const handler = (event) => {
        if (event.key !== null && event.key !== STORE_KEY) return
        const next = readSettings()
        cache = next
        applyToDocument(next)
        for (const fn of listeners) fn(next)
      }
      window.addEventListener('storage', handler)
      return () => window.removeEventListener('storage', handler)
    }

    function useSettings() {
      const [value, setValue] = React.useState(currentSettings)
      React.useEffect(() => {
        // A write can land between render and effect; resync once, then subscribe.
        setValue(currentSettings())
        return subscribeSettings(setValue)
      }, [])
      return value
    }
    //#endregion

    //#region sections: the host's registry, and the nav rows we mark
    /**
     * Read the section list from the slot registry, not from the DOM.
     * The nav may not be mounted at all (the panel is portal-rendered on open), so
     * a DOM-driven list would show `[]` on a cold start and then quietly write an
     * empty list over the user's choices. `entries()` returns a cached array, so
     * this is cheap and stable enough to run on every sync.
     */
    function collectSections(ctx) {
      const out = []
      const slots = ctx === null || ctx === undefined ? null : ctx.slots
      if (slots === null || slots === undefined || typeof slots.entries !== 'function') return out
      let entries = []
      try {
        entries = slots.entries('settings.section') || []
      } catch (error) {
        return out
      }
      for (const entry of entries) {
        const options = entry === null || entry === undefined ? null : entry.options
        if (options === null || options === undefined) continue
        const id = typeof options.id === 'string' ? options.id : ''
        if (id === '') continue // a list entry without an id cannot be hidden by id
        let label = options.label
        if (typeof label === 'function') {
          try {
            label = label()
          } catch (error) {
            label = ''
          }
        }
        out.push({
          id,
          order: typeof options.order === 'number' ? options.order : 0,
          label: typeof label === 'string' ? label : '',
        })
      }
      // Same sort the shell uses, so index pairing below stays honest.
      out.sort((a, b) => a.order - b.order)
      return out
    }

    /** The host settings shell, through the store its `sidebar.settings` handle carries. */
    function shellActionsOf(ctx) {
      const slots = ctx === null || ctx === undefined ? null : ctx.slots
      if (slots === null || slots === undefined || typeof slots.entriesOfSlot !== 'function') return null
      try {
        const handles = slots.entriesOfSlot('sidebar.settings')
        const handle = Array.isArray(handles) ? handles[0] : null
        if (handle === null || handle === undefined) return null
        const store = handle.store
        if (store === null || store === undefined || typeof store.create !== 'function') return null
        const instance = store.create()
        const actions = instance === null || instance === undefined ? null : instance.actions
        return actions === null || actions === undefined ? null : actions
      } catch (error) {
        return null
      }
    }

    function navElement() {
      if (typeof document === 'undefined' || document === null) return null
      if (typeof document.querySelector !== 'function') return null
      const panel = document.querySelector(PANEL)
      if (panel === null) return null
      return typeof panel.querySelector === 'function' ? panel.querySelector(':scope > nav') : null
    }

    /**
     * The host renders the nav from the same registry, but it writes no id onto the
     * row (only the label text and the icon), so the only stable handle we can put
     * on a row ourselves is the id we know is at that index. Labels are used first
     * because they survive a reorder; the index pairing is the fallback, and both
     * sides sort by `order`, so they agree.
     */
    function markNavRows(sections) {
      const nav = navElement()
      if (nav === null || typeof nav.querySelectorAll !== 'function') return 0
      const cells = nav.querySelectorAll('button')
      if (cells === null || typeof cells.length !== 'number') return 0
      const byLabel = new Map()
      for (const section of sections) {
        if (section.label !== '' && !byLabel.has(section.label)) byLabel.set(section.label, section.id)
      }
      let marked = 0
      for (let index = 0; index < cells.length; index += 1) {
        const cell = cells[index]
        if (cell === null || cell === undefined || typeof cell.setAttribute !== 'function') continue
        const text = typeof cell.textContent === 'string' ? cell.textContent.trim() : ''
        const byText = text === '' ? undefined : byLabel.get(text)
        const fallback = index < sections.length ? sections[index].id : ''
        const id = byText !== undefined ? byText : fallback
        if (id === '') continue
        cell.setAttribute(NAV_ID_ATTR, id)
        marked += 1
      }
      return marked
    }

    /** Hide exactly the rows marked with a hidden id; leave every other node alone. */
    function applyHiddenRows(hidden) {
      const nav = navElement()
      if (nav === null || typeof nav.querySelectorAll !== 'function') return 0
      const cells = nav.querySelectorAll('[' + NAV_ID_ATTR + ']')
      if (cells === null || typeof cells.length !== 'number') return 0
      const hide = new Set(Array.isArray(hidden) ? hidden : [])
      let hiddenCount = 0
      for (const cell of cells) {
        if (cell === null || cell === undefined || typeof cell.getAttribute !== 'function') continue
        const id = cell.getAttribute(NAV_ID_ATTR)
        if (id !== null && id !== '' && hide.has(id)) {
          cell.setAttribute(HIDDEN_ATTR, '1')
          hiddenCount += 1
        } else if (typeof cell.removeAttribute === 'function') {
          cell.removeAttribute(HIDDEN_ATTR)
        }
      }
      return hiddenCount
    }

    /** Which section the shell currently shows, read from the row the host marks current. */
    function activeSectionId() {
      const nav = navElement()
      if (nav === null || typeof nav.querySelector !== 'function') return ''
      let current = null
      try {
        current = nav.querySelector('button[aria-current="true"]')
      } catch (error) {
        current = null
      }
      if (current === null || typeof current.getAttribute !== 'function') return ''
      const id = current.getAttribute(NAV_ID_ATTR)
      return typeof id === 'string' ? id : ''
    }

    /**
     * Ask the shell to show a section, then check that it actually did.
     * `openSection(state, id)` only assigns `activeId`; it does not guarantee a
     * render. Navigating a hidden page is the one feature that depends on this
     * working, so a fire-and-forget call is not enough: poll for the row to become
     * current and fall back to clicking the row (which also un-hides it first,
     * since a hidden row cannot be clicked).
     */
    function openSection(ctx, id) {
      const sid = typeof id === 'string' ? id.trim() : ''
      if (sid === '' || sid === SECTION_ID) return false
      const actions = shellActionsOf(ctx)
      if (actions !== null) {
        if (typeof actions.openSection === 'function') {
          try {
            actions.openSection(sid)
          } catch (error) {
            /* fall through to the DOM fallback */
          }
        } else if (typeof actions.select === 'function') {
          try {
            actions.select(sid)
          } catch (error) {
            /* fall through to the DOM fallback */
          }
        }
      }
      let attempts = 0
      const step = () => {
        if (activeSectionId() === sid) return
        attempts += 1
        if (attempts > OPEN_ATTEMPTS) {
          clickNavRow(sid)
          return
        }
        setTimeout(step, OPEN_INTERVAL_MS)
      }
      setTimeout(step, OPEN_INTERVAL_MS)
      return true
    }

    /** Last resort: click the row. Un-hide it first or the browser refuses the hit. */
    function clickNavRow(id) {
      const nav = navElement()
      if (nav === null || typeof nav.querySelectorAll !== 'function') return false
      const cells = nav.querySelectorAll('[' + NAV_ID_ATTR + ']')
      if (cells === null) return false
      for (const cell of cells) {
        if (typeof cell.getAttribute !== 'function') continue
        if (cell.getAttribute(NAV_ID_ATTR) !== id) continue
        if (typeof cell.removeAttribute === 'function') cell.removeAttribute(HIDDEN_ATTR)
        if (typeof cell.click === 'function') cell.click()
        return true
      }
      return false
    }

    /**
     * Keep the nav in step with the settings, without the user having to visit our
     * page first: run once now, then on every settings change, every registry
     * change, and whenever the panel is portal-mounted into the body.
     */
    function installNavSync(ctx) {
      let disposed = false
      const sync = () => {
        if (disposed) return
        markNavRows(collectSections(ctx))
        applyHiddenRows(currentSettings().hidden)
      }
      sync()
      const offSettings = subscribeSettings(sync)
      let offSlots = () => {}
      if (typeof ctx.slots.subscribe === 'function') {
        try {
          const disposer = ctx.slots.subscribe('settings.section', sync)
          if (typeof disposer === 'function') offSlots = disposer
        } catch (error) {
          offSlots = () => {}
        }
      }
      let observer = null
      if (typeof MutationObserver === 'function' && typeof document !== 'undefined'
        && document !== null && document.body !== undefined && document.body !== null) {
        observer = new MutationObserver(sync)
        observer.observe(document.body, { childList: true })
      }
      return () => {
        disposed = true
        offSettings()
        offSlots()
        if (observer !== null) observer.disconnect()
      }
    }
    //#endregion

    //#region components
    function translateOf(props) {
      return typeof props.t === 'function' ? props.t : (key) => key
    }

    /** Chevron, 14px, drawn by hand so a missing primitives module cannot break us. */
    function Chevron(props) {
      const pointsRight = props.direction === 'right'
      return h('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', {
        d: pointsRight ? 'M6.25 3.5 10.75 8l-4.5 4.5' : 'M9.75 3.5 5.25 8l4.5 4.5',
        stroke: 'currentColor',
        strokeWidth: 1.5,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      }))
    }

    /** `settings.action`: the rail toggle that sits left of the shipped buttons. */
    function RailToggle(props) {
      const t = translateOf(props)
      const settings = useSettings()
      const buttonRef = React.useRef(null)
      const ownedNavId = React.useRef(false)
      const [controls, setControls] = React.useState(NAV_ID)
      const collapsed = settings.navCollapsed === true

      React.useEffect(() => {
        // Lend the host's <nav> an id so aria-controls has something to point at.
        const button = buttonRef.current
        const panel = typeof button?.closest === 'function' ? button.closest(PANEL) : null
        const nav = panel === null ? null : panel.querySelector(':scope > nav')
        if (nav === null) return undefined
        if (nav.id === '') {
          nav.id = NAV_ID
          ownedNavId.current = true
          setControls(NAV_ID)
        } else {
          setControls(nav.id)
        }
        return () => {
          if (ownedNavId.current && nav.isConnected !== false) nav.removeAttribute('id')
        }
      }, [])

      const label = collapsed ? t('rail.expand') : t('rail.collapse')

      return h('button', {
        ref: buttonRef,
        type: 'button',
        className: 'bsp-rail-toggle',
        'aria-expanded': collapsed ? 'false' : 'true',
        'aria-controls': controls,
        'aria-label': label,
        title: label,
        onClick: () => {
          writeSettings({ navCollapsed: !collapsed })
        },
      }, h(Chevron, { direction: collapsed ? 'right' : 'left' }))
    }

    /** `settings.section.icon`: two panes, one narrow — the thing this plugin does. */
    function SectionIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 16
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        h('rect', {
          key: 'frame',
          x: 2,
          y: 3,
          width: 12,
          height: 10,
          rx: 2,
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
        h('path', {
          key: 'rail',
          d: 'M6.5 3v10',
          stroke: 'currentColor',
          strokeWidth: 1.3,
        }),
      ])
    }

    /** `settings.section`: the two switches plus "restore defaults". */
    function SettingsPage(props) {
      const t = translateOf(props)
      const settings = useSettings()
      const [notice, setNotice] = React.useState('')

      React.useEffect(() => {
        if (notice === '') return undefined
        const id = setTimeout(() => setNotice(''), 4000)
        return () => clearTimeout(id)
      }, [notice])

      /** Every write goes through here, so a failed write is never silent. */
      const write = (patch) => {
        writeSettings(patch)
        if (lastError === 'write') setNotice(t('page.saveFailed'))
      }

      const row = (titleKey, hintKey, checked, onToggle, disabled) => h('div', {
        key: titleKey,
        className: 'bsp-row',
      }, [
        h('div', { key: 'text', className: 'bsp-rowText' }, [
          h('div', { key: 'label', className: 'bsp-rowLabel' }, t(titleKey)),
          h('div', { key: 'hint', className: 'bsp-rowHint' }, t(hintKey)),
        ]),
        h('input', {
          key: 'check',
          type: 'checkbox',
          className: 'bsp-check',
          checked,
          disabled: disabled === true ? true : undefined,
          'aria-label': t(titleKey),
          onChange: (event) => onToggle(event.target.checked),
        }),
      ])

      /**
       * One row per settings page in the registry, including the hidden ones —
       * that is the whole point: the list is the only door back into a page whose
       * nav row is gone. Our own page is listed too, but read-only, so the list
       * explains why it can never be in it.
       */
      const sectionRows = () => {
        const sections = collectSections(props.ctx)
        const hidden = settings.hidden
        if (sections.length === 0) {
          return [h('p', { key: 'empty', className: 'bsp-sub' }, t('pages.empty'))]
        }
        return sections.map((section) => {
          const self = section.id === SECTION_ID
          const isHidden = !self && hidden.indexOf(section.id) !== -1
          const name = section.label === '' ? section.id : section.label
          return h('div', {
            key: section.id,
            className: 'bsp-sectionRow',
            'data-bsp-section': section.id,
            'data-bsp-section-hidden': isHidden ? '1' : '0',
          }, [
            h('button', {
              key: 'open',
              type: 'button',
              className: 'bsp-sectionLink',
              'aria-disabled': self ? 'true' : undefined,
              title: self ? t('pages.self') : name,
              onClick: () => {
                if (self) return
                const ok = openSection(props.ctx, section.id)
                if (!ok) setNotice(t('pages.openFailed'))
              },
            }, name),
            h('span', { key: 'state', className: 'bsp-sectionState' },
              self ? t('pages.self') : (isHidden ? t('pages.hidden') : '')),
            self ? null : h('input', {
              key: 'hide',
              type: 'checkbox',
              className: 'bsp-check',
              checked: isHidden,
              'aria-label': name,
              onChange: (event) => {
                // Read the live list, not the one this render captured: two fast
                // toggles can land before React re-renders, and the second must not
                // resurrect the first one's id.
                const next = readSettings().hidden.filter((item) => item !== section.id)
                if (event.target.checked) next.push(section.id)
                write({ hidden: next })
              },
            }),
          ])
        })
      }

      return h('div', { className: 'bsp-page' }, [
        h('div', { key: 'head', className: 'bsp-head' }, [
          h('h2', { key: 'title', className: 'bsp-title' }, t('page.title')),
          h('p', { key: 'intro', className: 'bsp-sub' }, t('page.intro')),
        ]),
        row('page.fullscreen', 'page.fullscreenHint', settings.fullscreen === true,
          (next) => write({ fullscreen: next })),
        row('page.navCollapsed', 'page.navCollapsedHint',
          settings.navCollapsed === true,
          (next) => write({ navCollapsed: next })),
        h('div', { key: 'sections', className: 'bsp-sections' }, [
          h('h3', { key: 'title', className: 'bsp-rowLabel' }, t('pages.title')),
          h('p', { key: 'intro', className: 'bsp-sub' }, t('pages.intro')),
          ...sectionRows(),
        ]),
        h('div', { key: 'actions', className: 'bsp-actions' }, [
          h('button', {
            key: 'reset',
            type: 'button',
            className: 'bsp-button',
            onClick: () => {
              resetSettings()
              setNotice(lastError === 'write' ? t('page.saveFailed') : t('page.resetDone'))
            },
          }, t('page.reset')),
          h('span', { key: 'notice', className: 'bsp-notice', role: 'status' }, notice),
        ]),
        h('p', { key: 'note', className: 'bsp-note' }, t('page.note')),
      ])
    }
    //#endregion

    //#region entry
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      cache = readSettings()
      applyToDocument(cache)

      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), `${NS}: dictionaries`)

      ctx.effect(() => {
        const style = document.createElement('style')
        style.dataset.plugin = NS
        style.textContent = CSS
        document.head.appendChild(style)
        return () => {
          style.remove()
          clearDocument()
        }
      }, `${NS}: styles`)

      ctx.effect(() => subscribeSettings(applyToDocument), `${NS}: attributes`)
      ctx.effect(() => watchStorage(), `${NS}: storage`)
      ctx.effect(() => installNavSync(ctx), `${NS}: nav sync`)

      ctx.slots.inject('settings.action', () => ctx.slots.register({
        name: 'settings.action',
        id: ACTION_ID,
        order: 0,
        locale: NS,
      }, (props) => h(RailToggle, { t })))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SECTION_ID,
        order: SECTION_ORDER,
        label: () => t('section.nav'),
        locale: NS,
      }, (props) => h(SettingsPage, { close: props.close, t, ctx })))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SECTION_ID,
        order: SECTION_ORDER,
      }, SectionIcon))
    }

    const module = {
      inject: ['slots', 'locale'],
      apply,
      // Test surface. The loader only reads `apply` / `inject`; the rest exist so
      // `test/settings-page.test.mjs` can assert on the real strings and store.
      VERSION,
      NS,
      CSS,
      STORE_KEY,
      SETTINGS_VERSION,
      DEFAULTS,
      FULLSCREEN_ATTR,
      NAV_ATTR,
      NAV_ID,
      PANEL,
      SECTION_ID,
      SECTION_ORDER,
      ACTION_ID,
      ZH,
      EN,
      sanitizeSettings,
      sanitizeHidden,
      collectSections,
      markNavRows,
      applyHiddenRows,
      activeSectionId,
      openSection,
      shellActionsOf,
      installNavSync,
      HIDDEN_MAX,
      NAV_ID_ATTR,
      HIDDEN_ATTR,
      readSettings,
      writeSettings,
      resetSettings,
      subscribeSettings,
      applyToDocument,
      clearDocument,
      currentSettings,
      lastErrorOf: () => lastError,
      RailToggle,
      SettingsPage,
      SectionIcon,
      Chevron,
    }
    return module
  },
})
