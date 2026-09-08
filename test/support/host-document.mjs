export function matchesSelector(target, selector) {
  return selector.split(',').some((part) => {
    const tokens = part.trim().match(/^[a-z]+|[.#][\w-]+|\[[^\]]+\]/gi) ?? []
    return tokens.length > 0 && tokens.every((token) => {
      if (token.startsWith('.')) return target.classList.has(token.slice(1))
      if (token.startsWith('#')) return target.id === token.slice(1)
      if (token.startsWith('[')) return target.attributes.has(token.slice(1, -1))
      return target.tagName === token.toUpperCase()
    })
  })
}

export function descendants(target) {
  return target.children.flatMap((child) => [child, ...descendants(child)])
}

/* The one part of `CSSStyleDeclaration` a host script needs: the custom
 * properties it writes on an element, readable back by name. */
export function styleDeclaration() {
  const properties = new Map()

  return {
    properties,
    setProperty(name, value) { properties.set(name, value) },
    removeProperty(name) { properties.delete(name) },
    getPropertyValue(name) { return properties.get(name) ?? '' }
  }
}

export function node(tag, { id = '', classes = [], attributes = {}, ...rest } = {}) {
  const self = {
    tagName: tag.toUpperCase(), id, classList: new Set(classes), style: styleDeclaration(),
    attributes: new Map(Object.entries(attributes)), children: [], listeners: new Map(),
    parentElement: null, textContent: '', focused: false, clicks: 0, ...rest,
    setAttribute(name, value) { self.attributes.set(name, value) },
    getAttribute(name) { return self.attributes.has(name) ? self.attributes.get(name) : null },
    removeAttribute(name) { self.attributes.delete(name); if (name === 'id') self.id = '' },
    addEventListener(type, handler) { self.listeners.set(type, [...(self.listeners.get(type) ?? []), handler]) },
    appendChild(child) { child.parentElement = self; self.children.push(child); return child },
    remove() {
      const siblings = self.parentElement?.children
      if (siblings) siblings.splice(siblings.indexOf(self), 1)
      self.parentElement = null
    },
    cloneNode() { return node(tag, { id: self.id, classes: [...self.classList], attributes: Object.fromEntries(self.attributes) }) },
    focus() { self.focused = true },
    /* A click a script performs on an element rather than one a user delivers:
     * a hidden file input is opened this way, and the host reads it as the same
     * event either way. */
    click() { self.clicks += 1; self.dispatch('click') },
    setSelectionRange(start, end) { self.selectionStart = start; self.selectionEnd = end },
    matches: (selector) => matchesSelector(self, selector),
    closest(selector) {
      for (let current = self; current; current = current.parentElement) {
        if (matchesSelector(current, selector)) return current
      }
      return null
    },
    querySelector: (selector) => descendants(self).find((child) => matchesSelector(child, selector)) ?? null,
    querySelectorAll: (selector) => descendants(self).filter((child) => matchesSelector(child, selector)),
    dispatch(type, event = {}) {
      for (const handler of self.listeners.get(type) ?? []) handler({ target: self, preventDefault() {}, stopPropagation() {}, ...event })
    }
  }
  return self
}
