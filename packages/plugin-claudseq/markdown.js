/* Claudseq's Markdown renderer: turns the text Claude writes into DOM nodes in
 * the host document.
 *
 * Model output is untrusted text. Every piece of it becomes a text node or the
 * `textContent` of an element this file creates, so markup in a reply — an
 * `<img onerror>`, a `<script>`, a `javascript:` link — is shown as the
 * characters it is and never parsed. No HTML string is assembled anywhere
 * here. A link is only a link when it points at http, https or mailto, and
 * following it is the host's job: `options.onLink` receives the URL.
 *
 * It covers what a coding assistant writes: headings, paragraphs, bold,
 * italic, strikethrough, inline code, fenced code, lists (nested, ordered,
 * task), links, blockquotes, tables and rules.
 */

var ClaudseqMarkdown = (function () {
  const SAFE_LINK = /^(?:https?:\/\/|mailto:)/i

  function el(doc, tag, className, text) {
    const node = doc.createElement(tag)
    if (className) node.classList.add(className)
    if (text !== undefined) node.textContent = text
    return node
  }

  function appendText(doc, parent, text) {
    if (text) parent.appendChild(doc.createTextNode(text))
  }

  /* ------------------------------------------------------------- inline */

  function findClosing(text, marker, from) {
    let index = text.indexOf(marker, from)
    while (index !== -1 && text[index - 1] === '\\') index = text.indexOf(marker, index + 1)
    return index
  }

  function linkNode(doc, label, url, options) {
    if (!SAFE_LINK.test(url)) return null
    const anchor = el(doc, 'a', 'claudseq-md-link')
    anchor.setAttribute('href', url)
    anchor.setAttribute('title', url)
    anchor.setAttribute('data-claudseq-link', url)
    anchor.addEventListener('click', (event) => {
      event.preventDefault()
      options.onLink?.(url)
    })
    /* A label is not linked again: a bare URL is its own label. */
    inline(doc, anchor, label, { ...options, inLink: true })
    return anchor
  }

  function inline(doc, parent, text, options) {
    let plain = ''
    let index = 0
    const flush = () => {
      appendText(doc, parent, plain)
      plain = ''
    }

    while (index < text.length) {
      const char = text[index]
      const rest = text.slice(index)

      if (char === '\\' && index + 1 < text.length && /[\\`*_{}[\]()#+\-.!~|<>]/.test(text[index + 1])) {
        plain += text[index + 1]
        index += 2
        continue
      }

      if (char === '`') {
        const run = /^`+/.exec(rest)[0]
        const close = text.indexOf(run, index + run.length)
        if (close !== -1) {
          flush()
          const code = text.slice(index + run.length, close)
          parent.appendChild(el(doc, 'code', 'claudseq-md-code', code.length > 1 && code.startsWith(' ') && code.endsWith(' ') ? code.slice(1, -1) : code))
          index = close + run.length
          continue
        }
      }

      const strong = /^(\*\*|__)(?=\S)/.exec(rest)
      if (strong) {
        const close = findClosing(text, strong[1], index + 2)
        if (close !== -1 && text[close - 1] !== ' ') {
          flush()
          const node = el(doc, 'strong')
          inline(doc, node, text.slice(index + 2, close), options)
          parent.appendChild(node)
          index = close + 2
          continue
        }
      }

      if (rest.startsWith('~~')) {
        const close = findClosing(text, '~~', index + 2)
        if (close !== -1) {
          flush()
          const node = el(doc, 'del')
          inline(doc, node, text.slice(index + 2, close), options)
          parent.appendChild(node)
          index = close + 2
          continue
        }
      }

      if ((char === '*' || char === '_') && /\S/.test(text[index + 1] ?? '') && !(char === '_' && /\w/.test(text[index - 1] ?? ''))) {
        let close = findClosing(text, char, index + 1)
        while (close !== -1 && (text[close + 1] === char || text[close - 1] === ' ' || (char === '_' && /\w/.test(text[close + 1] ?? '')))) {
          close = findClosing(text, char, close + (text[close + 1] === char ? 2 : 1))
        }
        if (close !== -1) {
          flush()
          const node = el(doc, 'em')
          inline(doc, node, text.slice(index + 1, close), options)
          parent.appendChild(node)
          index = close + 1
          continue
        }
      }

      if (char === '[' && !options.inLink) {
        const match = /^\[([^\]]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(rest)
        if (match) {
          const anchor = linkNode(doc, match[1] || match[2], match[2], options)
          if (anchor) {
            flush()
            parent.appendChild(anchor)
            index += match[0].length
            continue
          }
        }
      }

      if (char === '<' && !options.inLink) {
        const match = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest)
        if (match) {
          flush()
          parent.appendChild(linkNode(doc, match[1], match[1], options))
          index += match[0].length
          continue
        }
      }

      if ((char === 'h' || char === 'H') && !options.inLink && !/\w/.test(text[index - 1] ?? '')) {
        const match = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"*_~]/i.exec(rest)
        if (match) {
          flush()
          parent.appendChild(linkNode(doc, match[0], match[0], options))
          index += match[0].length
          continue
        }
      }

      if (char === '\n') {
        if (plain.endsWith('  ') || plain.endsWith('\\')) {
          plain = plain.replace(/(?: {2,}|\\)$/, '')
          flush()
          parent.appendChild(doc.createElement('br'))
        } else {
          plain += ' '
        }
        index += 1
        continue
      }

      plain += char
      index += 1
    }
    flush()
  }

  /* -------------------------------------------------------------- blocks */

  const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/
  const HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?(?:\s+#+)?\s*$/
  const RULE = /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/
  const QUOTE = /^ {0,3}>\s?/
  const ITEM = /^(\s*)([-*+]|\d{1,9}[.)])(\s+|$)(.*)$/
  const TABLE_RULE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/

  const indentOf = (line) => /^\s*/.exec(line)[0].replace(/\t/g, '    ').length
  const blank = (line) => !line || !line.trim()

  function startsBlock(lines, index) {
    const line = lines[index]
    return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || ITEM.test(line) ||
      (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]) && lines[index + 1].includes('-'))
  }

  function cells(line) {
    let trimmed = line.trim()
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1)
    if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) trimmed = trimmed.slice(0, -1)
    const found = []
    let current = ''
    for (let index = 0; index < trimmed.length; index += 1) {
      if (trimmed[index] === '\\' && trimmed[index + 1] === '|') {
        current += '|'
        index += 1
      } else if (trimmed[index] === '|') {
        found.push(current.trim())
        current = ''
      } else {
        current += trimmed[index]
      }
    }
    found.push(current.trim())
    return found
  }

  function table(doc, lines, start, options) {
    const head = cells(lines[start])
    const aligns = cells(lines[start + 1]).map((cell) => cell.startsWith(':') && cell.endsWith(':') ? 'center' : cell.endsWith(':') ? 'right' : null)
    const wrapper = el(doc, 'div', 'claudseq-md-table')
    const node = el(doc, 'table')
    const thead = el(doc, 'thead')
    const headRow = el(doc, 'tr')
    head.forEach((cell, column) => {
      const th = el(doc, 'th')
      if (aligns[column]) th.setAttribute('data-claudseq-align', aligns[column])
      inline(doc, th, cell, options)
      headRow.appendChild(th)
    })
    thead.appendChild(headRow)
    node.appendChild(thead)
    const tbody = el(doc, 'tbody')
    let index = start + 2
    while (index < lines.length && !blank(lines[index]) && lines[index].includes('|')) {
      const row = el(doc, 'tr')
      const values = cells(lines[index])
      head.forEach((_, column) => {
        const td = el(doc, 'td')
        if (aligns[column]) td.setAttribute('data-claudseq-align', aligns[column])
        inline(doc, td, values[column] ?? '', options)
        row.appendChild(td)
      })
      tbody.appendChild(row)
      index += 1
    }
    node.appendChild(tbody)
    wrapper.appendChild(node)
    return { node: wrapper, next: index }
  }

  function list(doc, lines, start, options) {
    const first = ITEM.exec(lines[start])
    const base = indentOf(first[1])
    const ordered = /\d/.test(first[2])
    const node = el(doc, ordered ? 'ol' : 'ul', 'claudseq-md-list')
    if (ordered) {
      const number = Number.parseInt(first[2], 10)
      if (number !== 1) node.setAttribute('start', String(number))
    }
    const items = []
    let index = start
    let loose = false
    while (index < lines.length) {
      const line = lines[index]
      const match = ITEM.exec(line)
      if (match && indentOf(match[1]) === base && /\d/.test(match[2]) === ordered) {
        items.push({ lines: [match[4]], width: base + match[2].length + Math.min(match[3].length || 1, 4) })
        index += 1
        continue
      }
      if (!items.length) break
      const current = items[items.length - 1]
      if (blank(line)) {
        const next = lines[index + 1]
        if (next !== undefined && !blank(next) && indentOf(next) > base) {
          current.lines.push('')
          loose = loose || !ITEM.test(next) || indentOf(next) < current.width
          index += 1
          continue
        }
        if (next !== undefined && ITEM.test(next) && indentOf(ITEM.exec(next)[1]) === base) {
          loose = true
          index += 1
          continue
        }
        break
      }
      if (indentOf(line) > base) {
        current.lines.push(line.slice(Math.min(indentOf(line), current.width)))
        index += 1
        continue
      }
      if (match || startsBlock(lines, index) || current.lines[current.lines.length - 1] === '') break
      current.lines.push(line.trim())
      index += 1
    }

    for (const item of items) {
      const li = el(doc, 'li')
      const task = /^\[([ xX])\]\s+/.exec(item.lines[0])
      if (task) {
        item.lines[0] = item.lines[0].slice(task[0].length)
        li.setAttribute('data-claudseq-task', task[1] === ' ' ? 'open' : 'done')
        li.appendChild(el(doc, 'span', 'claudseq-md-check', task[1] === ' ' ? '☐ ' : '☑ '))
      }
      blocks(doc, li, item.lines, options, !loose)
      node.appendChild(li)
    }
    return { node, next: index }
  }

  function blocks(doc, parent, lines, options, tight = false) {
    let index = 0
    while (index < lines.length) {
      const line = lines[index]
      if (blank(line)) {
        index += 1
        continue
      }

      const fence = FENCE.exec(line)
      if (fence) {
        const marker = fence[1]
        const body = []
        index += 1
        while (index < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}\\s*$`).test(lines[index])) {
          body.push(lines[index])
          index += 1
        }
        index += 1
        const pre = el(doc, 'pre', 'claudseq-md-pre')
        if (fence[2]) pre.setAttribute('data-claudseq-lang', fence[2])
        pre.appendChild(el(doc, 'code', null, body.join('\n')))
        parent.appendChild(pre)
        continue
      }

      const heading = HEADING.exec(line)
      if (heading) {
        const node = el(doc, `h${heading[1].length}`, 'claudseq-md-heading')
        inline(doc, node, heading[2] ?? '', options)
        parent.appendChild(node)
        index += 1
        continue
      }

      if (RULE.test(line)) {
        parent.appendChild(el(doc, 'hr'))
        index += 1
        continue
      }

      if (QUOTE.test(line)) {
        const quoted = []
        while (index < lines.length && !blank(lines[index]) && (QUOTE.test(lines[index]) || !startsBlock(lines, index))) {
          quoted.push(lines[index].replace(QUOTE, ''))
          index += 1
        }
        const node = el(doc, 'blockquote', 'claudseq-md-quote')
        blocks(doc, node, quoted, options)
        parent.appendChild(node)
        continue
      }

      if (line.includes('|') && index + 1 < lines.length && TABLE_RULE.test(lines[index + 1]) && lines[index + 1].includes('-')) {
        const built = table(doc, lines, index, options)
        parent.appendChild(built.node)
        index = built.next
        continue
      }

      if (ITEM.test(line) && ITEM.exec(line)[4] !== undefined) {
        const built = list(doc, lines, index, options)
        if (built.next > index) {
          parent.appendChild(built.node)
          index = built.next
          continue
        }
      }

      const paragraph = [line.replace(/^\s+/, '')]
      index += 1
      while (index < lines.length && !blank(lines[index]) && !startsBlock(lines, index)) {
        paragraph.push(lines[index].replace(/^\s+/, ''))
        index += 1
      }
      const text = paragraph.join('\n')
      if (tight) {
        inline(doc, parent, text, options)
      } else {
        const node = el(doc, 'p')
        inline(doc, node, text, options)
        parent.appendChild(node)
      }
      tight = false
    }
  }

  /* One element holding the rendered text, ready to append. */
  function render(doc, text, options = {}) {
    const root = doc.createElement('div')
    root.classList.add('claudseq-md')
    blocks(doc, root, String(text ?? '').replace(/\r\n?/g, '\n').split('\n'), options)
    return root
  }

  return { render }
})()
