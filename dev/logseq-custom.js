// Dev reloader for the logseq-dark-2026 plugins and theme.
//
// Pairs with `npm run dev` in that repo, which restages dist/ on every save and bumps
// dist/.reload-stamp.json. This polls the stamp and applies what changed:
//
//   action "reload" -> LSPluginCore.reload(id), the same call the Plugins page button makes
//   theme packages  -> re-read theme.css off disk and swap it in
//
// The theme needs that swap because Logseq's "beforereload" handler unregisters plugin
// themes with effect=false, which deliberately leaves the injected <link> in the DOM. A
// plugin reload therefore never re-fetches theme.css; only replacing the CSS ourselves does.
//
// custom.js is eval'd in the main renderer, so window.LSPluginCore and window.apis are in
// scope here -- neither is reachable from inside a plugin's sandbox.
//
// Install with `npm run dev:install -- <graph-dir>`, which writes a copy to
// <graph-dir>/logseq/custom.js with the stamp path below filled in. Logseq runs as the
// Windows app, so that is a Windows path even when the build runs in WSL.
(() => {
  const STAMP = '__STAMP_PATH__'
  const POLL_MS = 1000
  const STYLE_PREFIX = 'ls-dev-theme-'
  const TAG = '[ls-dev]'

  if (!window.apis || typeof window.apis.doAction !== 'function') {
    console.warn(TAG, 'no window.apis bridge; dev reloader needs the desktop app')
    return
  }

  let lastTs = null
  let timer = null

  const core = () => window.LSPluginCore

  const stylesheets = () =>
    Array.from(document.head.querySelectorAll('link[rel="stylesheet"]'))

  // Compare the raw href attribute, not link.href, which comes back normalized.
  const linkFor = (url) => stylesheets().find((el) => samePath(el.getAttribute('href'), url))

  function themeUrlFor(pid) {
    const c = core()
    if (!c) return null
    const current = c._currentTheme
    if (current && current.pid === pid && current.opt && current.opt.url) return current.opt.url
    const registered = c.themes && typeof c.themes.get === 'function' ? c.themes.get(pid) : null
    const hit = (registered || []).find((theme) => theme && theme.url)
    return hit ? hit.url : null
  }

  // Themes reach us under more than one scheme: _loadConfigThemes() prefixes
  // manifest-declared urls with assets://, while the copy saved in preferences.json is
  // file://. Strip whichever we get down to the plain OS path.
  function osPathOf(url) {
    let path = String(url || '').replace(/^(?:file|assets|lsp):\/\//i, '')
    try {
      path = decodeURIComponent(path)
    } catch (e) {
      // a literal '%' in the path is not an escape; use it as-is
    }
    if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1) // /C:/x -> C:/x
    return path
  }

  // Windows paths are case-insensitive and arrive with either slash, so the two urls for
  // one file must not be treated as two different stylesheets.
  const canonical = (url) => osPathOf(url).replace(/\\/g, '/').toLowerCase()
  const samePath = (a, b) => Boolean(a) && Boolean(b) && canonical(a) === canonical(b)

  async function swapThemeCss(pid) {
    const url = themeUrlFor(pid)
    if (!url) {
      console.warn(TAG, 'no registered theme url for', pid, '- is the theme selected?')
      return
    }
    const css = await window.apis.doAction(['readFile', osPathOf(url)])
    if (typeof css !== 'string') {
      console.warn(TAG, 'could not read', osPathOf(url))
      return
    }

    const id = STYLE_PREFIX + pid
    let style = document.getElementById(id)
    if (!style) {
      style = document.createElement('style')
      style.id = id
    }
    style.textContent = css
    document.head.appendChild(style) // re-append so it stays last and wins the cascade

    // Disable rather than remove the original: LSPluginCore still holds this node for its
    // eject(), and leaving it enabled would keep serving rules we have since deleted.
    const link = linkFor(url)
    if (link) link.disabled = true
  }

  // If the user picks a different theme, LSPluginCore ejects the link we shadowed. Our
  // style tag would otherwise linger and keep overriding the newly chosen theme.
  function dropOrphanedStyles() {
    for (const style of document.head.querySelectorAll(`style[id^="${STYLE_PREFIX}"]`)) {
      const pid = style.id.slice(STYLE_PREFIX.length)
      const url = themeUrlFor(pid)
      if (!url || !linkFor(url)) style.remove()
    }
  }

  async function apply(entry) {
    if (entry.action === 'reload') {
      const c = core()
      if (!c) return
      await c.reload(entry.id)
    }
    // After a reload too: the surviving <link> still serves the pre-edit CSS.
    if (entry.theme) await swapThemeCss(entry.id)
    console.log(TAG, entry.id, entry.action === 'reload' ? 'reloaded' : 'css updated')
  }

  async function tick() {
    let raw
    try {
      raw = await window.apis.doAction(['readFile', STAMP])
    } catch (e) {
      return // watcher not running, or nothing built yet
    }
    if (typeof raw !== 'string' || !raw.trim()) return

    let stamp
    try {
      stamp = JSON.parse(raw)
    } catch (e) {
      return // mid-write; the watcher renames atomically, so the next tick is clean
    }
    if (!stamp || stamp.ts === lastTs) {
      dropOrphanedStyles()
      return
    }

    const first = lastTs === null
    lastTs = stamp.ts
    dropOrphanedStyles()
    if (first) return // adopt the current state without reloading everything on startup

    for (const entry of stamp.changed || []) {
      try {
        await apply(entry)
      } catch (e) {
        console.error(TAG, 'failed to apply', entry && entry.id, e)
      }
    }
  }

  window.lsDev = {
    start() {
      if (timer) return
      timer = setInterval(() => { tick() }, POLL_MS)
      console.log(TAG, 'watching', STAMP)
    },
    stop() {
      clearInterval(timer)
      timer = null
      console.log(TAG, 'stopped')
    },
    // Check the stamp now instead of waiting for the next poll
    tick,
    // Force a refresh without waiting for a build, e.g. lsDev.reload('logseq-passage')
    reload: (id) => core().reload(id),
    css: (pid) => swapThemeCss(pid)
  }

  window.lsDev.start()
})()
