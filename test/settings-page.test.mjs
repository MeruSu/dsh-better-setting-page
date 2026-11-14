/**
 * Unit tests for `dsh-better-setting-page`.
 *
 * Same loading trick as `dsh-better-notice/test/classify.test.mjs`: stub
 * `window.__ModuleLoader__.load` to capture the factory, execute the real
 * `client.js` source with `new Function`, and assert on the exports. No bundler,
 * no jsdom, no React: `react` is replaced by a tiny recorder so the component
 * trees can be walked as plain objects.
 *
 * Everything here is pure logic over strings and shapes; whether the page really
 * fills the window is a machine check, not a unit test.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

let groups = 0
const failures = []

function check(name, fn) {
  groups += 1
  try {
    fn()
    console.log(`ok ${groups} - ${name}`)
  } catch (error) {
    failures.push({ name, error })
    console.log(`not ok ${groups} - ${name}`)
    console.log(`  ${error && error.message}`)
  }
}

function equal(actual, expected, what) {
  if (actual !== expected) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function truthy(value, what) {
  if (!value) throw new Error(`${what}: expected truthy, got ${JSON.stringify(value)}`)
}

function has(haystack, needle, what) {
  if (!haystack.includes(needle)) throw new Error(`${what}: missing ${JSON.stringify(needle)}`)
}

function absent(haystack, needle, what) {
  if (haystack.includes(needle)) throw new Error(`${what}: unexpectedly found ${JSON.stringify(needle)}`)
}

//#region harness
/** Minimal React stand-in: enough to build and walk elements, no re-rendering. */
function fakeReact() {
  const effects = []
  return {
    effects,
    createElement(type, props, ...children) {
      const flat = []
      const push = (value) => {
        if (Array.isArray(value)) value.forEach(push)
        else if (value !== null && value !== undefined && value !== false) flat.push(value)
      }
      push(children)
      if (props && Object.prototype.hasOwnProperty.call(props, 'children')) push(props.children)
      return { type, props: { ...(props || {}), children: flat } }
    },
    useState(initial) {
      const value = typeof initial === 'function' ? initial() : initial
      return [value, () => {}]
    },
    useEffect(fn) {
      const cleanup = fn()
      if (typeof cleanup === 'function') effects.push(cleanup)
      return undefined
    },
    useRef(initial) {
      return { current: initial === undefined ? null : initial }
    },
  }
}

/** localStorage that can be told to throw, for the quota path. */
function fakeStorage(initial) {
  const map = new Map(Object.entries(initial || {}))
  let throwOnWrite = false
  let throwOnRead = false
  return {
    map,
    throwOnWrite(value) { throwOnWrite = value },
    throwOnRead(value) { throwOnRead = value },
    getItem(key) {
      if (throwOnRead) throw new Error('read blocked')
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      if (throwOnWrite) throw new Error('QuotaExceededError')
      map.set(key, String(value))
    },
    removeItem(key) { map.delete(key) },
  }
}

/** `<html>` recorder: the only document node this plugin touches. */
function fakeDocument() {
  const attrs = new Map()
  const styles = []
  return {
    attrs,
    styles,
    documentElement: {
      setAttribute(name, value) { attrs.set(name, String(value)) },
      getAttribute(name) { return attrs.has(name) ? attrs.get(name) : null },
      removeAttribute(name) { attrs.delete(name) },
    },
    head: {
      appendChild(node) { styles.push(node); node.isConnected = true },
    },
    createElement(tag) {
      return { tagName: tag, dataset: {}, textContent: '', isConnected: false, remove() { this.isConnected = false } }
    },
  }
}

/**
 * Load the real module once per test group so each starts from a clean store.
 * `captured` collects every slot registration the plugin makes.
 */
function load(options = {}) {
  const React = fakeReact()
  const storage = options.storage || fakeStorage()
  const document = options.document || fakeDocument()
  const listeners = []
  const captured = []
  const effects = []
  const localeDictionaries = []

  const window = {
    localStorage: storage,
    addEventListener(type, fn) { if (type === 'storage') listeners.push(fn) },
    removeEventListener(type, fn) {
      const index = listeners.indexOf(fn)
      if (index >= 0) listeners.splice(index, 1)
    },
    dispatchStorage(event) { for (const fn of listeners) fn(event) },
  }

  const sandboxRequire = (name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require(${JSON.stringify(name)})`)
  }

  /** The loader stub also runs the factory, so the file is fully evaluated. */
  let mod = null
  window.__ModuleLoader__ = {
    load(entry) {
      equal(entry.id, 'dsh-better-setting-page', 'module id equals the package name')
      mod = entry.factory(sandboxRequire)
    },
  }

  new Function('window', 'document', 'require', source)(window, document, sandboxRequire)
  truthy(mod !== null, 'factory produced a module')

  const t = (key) => key
  const ctx = {
    locale: {
      bind(namespace) {
        equal(namespace, mod.NS, 'locale bind uses the plugin namespace')
        return t
      },
      register(namespace, dictionaries) {
        localeDictionaries.push({ namespace, dictionaries })
        return () => {}
      },
    },
    effect(fn, label) {
      const dispose = fn()
      effects.push({ label, dispose })
      return () => {}
    },
    slots: {
      inject(slotName, factory) {
        const dispose = factory()
        captured.push({ slotName, dispose })
        return () => {}
      },
      register(options, component) {
        captured.push({ options, component })
        return () => {}
      },
    },
  }

  mod.apply(ctx)

  return { mod, React, storage, document, listeners, captured, effects, localeDictionaries, window, t }
}
//#endregion

//#region 1. module shape
{
  const { mod } = load()
  check('exports apply and inject, and injects only slots + locale', () => {
    equal(typeof mod.apply, 'function', 'apply')
    equal(JSON.stringify(mod.inject), JSON.stringify(['slots', 'locale']), 'inject')
    equal(mod.VERSION, '0.1.0', 'version')
  })
  check('locale dictionaries ship zh and en with identical key sets', () => {
    const zh = Object.keys(mod.ZH).sort()
    const en = Object.keys(mod.EN).sort()
    equal(JSON.stringify(zh), JSON.stringify(en), 'zh/en key sets')
    truthy(zh.includes('rail.collapse'), 'has rail.collapse')
    truthy(zh.includes('page.fullscreen'), 'has page.fullscreen')
    truthy(zh.includes('page.reset'), 'has page.reset')
  })
}
//#endregion

//#region 2. slot registrations
{
  const { captured } = load()
  const registrations = captured.filter((item) => item.options !== undefined)
  check('registers the rail toggle on settings.action, never on settings.header', () => {
    const names = registrations.map((item) => item.options.name)
    truthy(names.includes('settings.action'), 'settings.action registered')
    absent(names.join(','), 'settings.header', 'settings.header must not be touched')
    const action = registrations.find((item) => item.options.name === 'settings.action')
    equal(action.options.id, 'better-setting-page.rail-toggle', 'action id (list slots require one)')
    equal(action.options.locale, 'better-setting-page', 'action locale so the slot injects t')
    equal(typeof action.options.label, 'undefined', 'no label on an icon button')
  })
  check('registers a section page and a matching nav icon', () => {
    const section = registrations.find((item) => item.options.name === 'settings.section')
    const icon = registrations.find((item) => item.options.name === 'settings.section.icon')
    truthy(section && icon, 'both slots registered')
    equal(section.options.id, 'better-setting-page', 'section id')
    equal(icon.options.id, 'better-setting-page', 'icon id must match the section id')
    equal(section.options.order, 50, 'section order')
    equal(typeof section.options.label, 'function', 'label must be a thunk, not a string')
    equal(section.options.label(), 'section.nav', 'thunk resolves through t')
  })
}
//#endregion

//#region 3. the stylesheet
{
  const { mod } = load()
  const css = mod.CSS
  check('anchors on the shipped panel attribute, not on hash class names', () => {
    has(css, 'div[data-shortcut-modal="settings"]', 'panel anchor')
    const hashClass = /\._?[A-Za-z0-9]{5,}_[A-Za-z0-9]{2,}_/.exec(css)
    if (hashClass !== null) throw new Error(`hash-like class name in CSS: ${hashClass[0]}`)
  })
  check('never uses !important', () => {
    absent(css, '!important', 'CSS')
  })
  check('fullscreen rules are gated on our own html attribute', () => {
    has(css, 'html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]', 'fullscreen rule')
    has(css, 'width: 100%', 'full width')
    has(css, 'height: 100%', 'full height')
    has(css, 'border-radius: 0', 'no panel radius')
    has(css, 'box-shadow: none', 'no panel shadow')
  })
  check('desktop title-bar height is given back as padding, with the web fallback', () => {
    has(css, 'var(--dsh-windows-titlebar-height', 'windows title-bar variable')
    has(css, 'var(--dsh-frame-top-clearance', 'frame clearance variable')
    has(css, 'padding-top: var(--bsp-top-pad)', 'padding applied')
    has(css, 'max(var(--dsh-windows-titlebar-height, 0px), var(--dsh-frame-top-clearance, 0px))', 'max() of both')
  })
  check('the mask keeps its hit area: no display:none, no pointer-events:none on it', () => {
    const maskRule = /html\[data-bsp-fullscreen="on"\] div:has\(> div\[data-shortcut-modal="settings"\]\) > div:first-child\{([^}]*)\}/.exec(css)
    truthy(maskRule, 'mask rule present')
    absent(maskRule[1], 'display', 'mask rule must not touch display')
    absent(maskRule[1], 'pointer-events', 'mask rule must not touch pointer-events')
    has(maskRule[1], 'background: transparent', 'mask paints nothing')
    has(maskRule[1], 'backdrop-filter: none', 'mask blurs nothing')
    absent(css, 'display: none', 'no display:none anywhere (it deletes click-outside-to-close)')
    absent(css, 'pointer-events: none', 'no pointer-events:none anywhere')
  })
  check('the header row is matched by descendant, because data-slot sits inside .actions', () => {
    has(css, '> div:has([data-slot="settings.action"])', 'descendant form for the header row')
    absent(css, '> div:has(> [data-slot="settings.action"])', 'direct-child form would match .actions, not .header')
    has(css, '> div:has(> [data-slot="settings.section"])', 'content column is the direct parent')
  })
  check('collapsing changes grid columns only, and hides labels accessibly', () => {
    has(css, 'grid-template-columns: 56px minmax(0, 1fr)', 'collapsed columns')
    has(css, '@media (min-width: 768px)', 'narrow screens are left to the host')
    has(css, 'clip-path: inset(50%)', 'visually-hidden utility')
    has(css, 'position: absolute', 'clip needs positioning to take effect')
    absent(css, 'grid-template-areas', 'area names are host hashes')
    absent(css, 'grid-template:', 'shorthand would reset the host area names')
  })
  check('content column gets min-height so the scroll container can shrink', () => {
    has(css, 'min-height: 0', 'min-height')
    has(css, 'max-width: 880px', 'readable line length')
  })
  check('the drag strip is only created on desktop platforms', () => {
    has(css, 'html[data-windows-titlebar][data-bsp-fullscreen="on"]', 'windows gate')
    has(css, 'html[data-platform="darwin"][data-bsp-fullscreen="on"]', 'darwin gate')
    has(css, '-webkit-app-region: drag', 'drag strip')
  })
}
//#endregion

//#region 4. store
{
  const { mod, storage } = load()
  check('defaults are full-screen on, rail expanded', () => {
    const defaults = mod.DEFAULTS
    equal(defaults.fullscreen, true, 'fullscreen default')
    equal(defaults.navCollapsed, false, 'navCollapsed default')
    equal(defaults.version, 1, 'version default')
  })
  check('storage key is namespaced and stable', () => {
    equal(mod.STORE_KEY, 'dsh.better-setting-page.settings', 'key')
    equal(mod.SETTINGS_VERSION, 1, 'settings version')
  })
  check('a missing or broken record falls back to defaults', () => {
    const fresh = mod.readSettings()
    equal(fresh.fullscreen, true, 'missing record → default fullscreen')
    storage.map.set(mod.STORE_KEY, '{not json')
    const broken = mod.readSettings()
    equal(broken.fullscreen, true, 'broken JSON → default')
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: 'yes', navCollapsed: 1 }))
    const wrongTypes = mod.readSettings()
    equal(wrongTypes.fullscreen, true, 'non-boolean fullscreen → default')
    equal(wrongTypes.navCollapsed, false, 'non-boolean navCollapsed → default')
  })
  check('unknown keys survive a read/write round trip', () => {
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: false, futureThing: { a: 1 } }))
    const read = mod.readSettings()
    equal(read.fullscreen, false, 'known key read')
    equal(JSON.stringify(read.unknown.futureThing), JSON.stringify({ a: 1 }), 'unknown key kept')
    mod.writeSettings({ navCollapsed: true })
    const stored = JSON.parse(storage.map.get(mod.STORE_KEY))
    equal(stored.navCollapsed, true, 'written key')
    equal(JSON.stringify(stored.unknown.futureThing), JSON.stringify({ a: 1 }), 'unknown key still on disk')
  })
  check('writeSettings notifies subscribers synchronously (storage events do not fire in this document)', () => {
    const seen = []
    const stop = mod.subscribeSettings((next) => seen.push(next.navCollapsed))
    mod.writeSettings({ navCollapsed: true })
    mod.writeSettings({ navCollapsed: false })
    stop()
    mod.writeSettings({ navCollapsed: true })
    equal(JSON.stringify(seen), JSON.stringify([true, false]), 'notified twice, then unsubscribed')
  })
  check('a quota failure still notifies and records the error', () => {
    storage.map.clear()
    const seen = []
    const stop = mod.subscribeSettings((next) => seen.push(next.fullscreen))
    storage.throwOnWrite(true)
    mod.writeSettings({ fullscreen: false })
    storage.throwOnWrite(false)
    stop()
    equal(seen.length, 1, 'listener still ran')
    equal(mod.lastErrorOf(), 'write', 'error recorded')
    equal(storage.map.get(mod.STORE_KEY), undefined, 'nothing on disk')
  })
  check('reset restores both defaults and keeps unknown keys', () => {
    storage.map.set(mod.STORE_KEY, JSON.stringify({ fullscreen: false, navCollapsed: true, keepMe: 7 }))
    mod.writeSettings({ fullscreen: false })
    const after = mod.resetSettings()
    equal(after.fullscreen, true, 'fullscreen back to default')
    equal(after.navCollapsed, false, 'navCollapsed back to default')
    equal(after.unknown.keepMe, 7, 'unknown key kept through reset')
  })
  check('html attributes mirror the settings and are removed on unload', () => {
    const { mod: fresh, document } = load()
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'on', 'fullscreen attribute')
    equal(document.attrs.get(fresh.NAV_ATTR), 'expanded', 'nav attribute')
    fresh.writeSettings({ fullscreen: false, navCollapsed: true })
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'off', 'toggled off')
    equal(document.attrs.get(fresh.NAV_ATTR), 'collapsed', 'collapsed')
    fresh.clearDocument()
    equal(document.attrs.has(fresh.FULLSCREEN_ATTR), false, 'fullscreen attribute removed')
    equal(document.attrs.has(fresh.NAV_ATTR), false, 'nav attribute removed')
  })
  check('a cross-window storage event is applied and broadcast', () => {
    const { mod: fresh, storage, window, document } = load()
    const seen = []
    fresh.subscribeSettings((next) => seen.push(next.fullscreen))
    storage.map.set(fresh.STORE_KEY, JSON.stringify({ fullscreen: false, navCollapsed: true }))
    window.dispatchStorage({ key: fresh.STORE_KEY })
    equal(seen.length, 1, 'subscriber notified')
    equal(document.attrs.get(fresh.FULLSCREEN_ATTR), 'off', 'attribute followed the event')
  })
}
//#endregion

//#region 5. wiring
{
  const { mod, document, effects, localeDictionaries, React } = load()
  check('apply injects exactly one stylesheet tagged with the plugin name', () => {
    equal(document.styles.length, 1, 'one <style>')
    equal(document.styles[0].dataset.plugin, mod.NS, 'tagged with the namespace')
    has(document.styles[0].textContent, 'data-shortcut-modal="settings"', 'stylesheet carries the rules')
  })
  check('apply registers the dictionaries and every effect has a disposer', () => {
    equal(localeDictionaries.length, 1, 'one register call (a second one throws in the host)')
    equal(localeDictionaries[0].namespace, mod.NS, 'namespace')
    truthy(effects.length >= 4, 'styles + attributes + storage + dictionaries')
    for (const entry of effects) {
      truthy(typeof entry.dispose === 'function', `effect ${entry.label} has a disposer`)
    }
  })
  check('the toggle button renders as a real button with the ARIA contract', () => {
    const tree = mod.RailToggle({ t: (key) => key })
    equal(tree.type, 'button', 'element type')
    equal(tree.props.type, 'button', 'type attribute')
    equal(tree.props.className, 'bsp-rail-toggle', 'class')
    equal(tree.props['aria-expanded'], 'true', 'expanded when the rail is expanded')
    equal(tree.props['aria-controls'], mod.NAV_ID, 'points at the nav id')
    equal(tree.props['aria-label'], 'rail.collapse', 'label names the action')
    equal(tree.props.title, 'rail.collapse', 'title matches the label')
    equal(tree.props['data-modal-autofocus'], undefined, 'must not steal initial focus')
    void React
  })
  check('the settings page renders two switches and a restore button', () => {
    const tree = mod.SettingsPage({ t: (key) => key })
    const rows = tree.props.children.filter((node) => node && node.props && node.props.className === 'bsp-row')
    equal(rows.length, 2, 'two rows')
    const boxes = rows.map((row) => row.props.children.find((child) => child && child.type === 'input'))
    equal(boxes.length, 2, 'two checkboxes')
    for (const box of boxes) {
      equal(box.props.type, 'checkbox', 'checkbox input')
      truthy(typeof box.props.onChange === 'function', 'checkbox is wired')
      truthy(typeof box.props['aria-label'] === 'string' && box.props['aria-label'].length > 0, 'checkbox has a name')
    }
    const actions = tree.props.children.find((node) => node && node.props && node.props.className === 'bsp-actions')
    const buttons = actions.props.children.filter((node) => node && node.type === 'button')
    equal(buttons.length, 1, 'one button')
    equal(buttons[0].props.className, 'bsp-button', 'button styled by us, not by a host class')
    truthy(typeof buttons[0].props.onClick === 'function', 'restore is wired')
  })
  check('props.t is used when the host injects one, and never assumed', () => {
    const tree = mod.RailToggle({ t: (key) => `T:${key}` })
    equal(tree.props['aria-label'], 'T:rail.collapse', 'translated label')
    const bare = mod.RailToggle({})
    equal(bare.props['aria-label'], 'rail.collapse', 'falls back to the key when t is absent')
  })
  check('a refused write is surfaced instead of silently reverting the switch', () => {
    const { mod: fresh, storage } = load()
    storage.throwOnWrite(true)
    const tree = fresh.SettingsPage({ t: (key) => key })
    const row = tree.props.children.filter((node) => node && node.props && node.props.className === 'bsp-row')[0]
    const box = row.props.children.find((child) => child && child.type === 'input')
    box.props.onChange({ target: { checked: false } })
    equal(fresh.lastErrorOf(), 'write', 'the failure is recorded')
    truthy(Object.keys(fresh.ZH).includes('page.saveFailed'), 'and there is a message for it')
  })
}
//#endregion

//#region 6. must-fail guard (lead's regression trap)
{
  check('REGRESSION TRAP: header selector must stay a descendant match', () => {
    const { mod } = load()
    // If someone "simplifies" this back to a direct child, the rule silently
    // styles `.actions` instead of `.header` and the fullscreen padding never
    // lands. This assertion is written to fail in exactly that case.
    const wrong = 'div[data-shortcut-modal="settings"] > div:has(> [data-slot="settings.action"])'
    if (mod.CSS.includes(wrong)) {
      throw new Error('header padding went back to the direct-child selector: it matches .actions, not .header')
    }
    truthy(mod.CSS.includes('> div:has([data-slot="settings.action"])'), 'descendant form present')
  })
  check('REGRESSION TRAP: fullscreen must stay gated on our own attribute', () => {
    const { mod } = load()
    if (!mod.CSS.includes('html[data-bsp-fullscreen="on"] div[data-shortcut-modal="settings"]')) {
      throw new Error('fullscreen rules are no longer gated on html[data-bsp-fullscreen="on"]')
    }
    const ungated = /(^|\n)div\[data-shortcut-modal="settings"\]\{/.test(mod.CSS)
    if (ungated) throw new Error('there is an ungated panel rule: it would apply even with fullscreen off')
  })
}
//#endregion

console.log('')
if (failures.length > 0) {
  console.log(`FAIL — ${failures.length} of ${groups} checks failed`)
  for (const failure of failures) console.log(`  ${failure.name}: ${failure.error && failure.error.message}`)
  process.exit(1)
}
console.log(`PASS — ${groups} groups`)
