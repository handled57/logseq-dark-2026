export function compareSpecificity(first, second) {
  return first[0] - second[0] || first[1] - second[1] || first[2] - second[2]
}

export function specificity(selector) {
  const total = [0, 0, 0]
  let rest = selector.trim()
  rest = rest.replace(/:(?:not|is|has|matches)\(([^()]*)\)/g, (_, inner) => {
    const best = inner.split(',').map(specificity).sort(compareSpecificity).pop() ?? [0, 0, 0]
    for (let i = 0; i < 3; i += 1) total[i] += best[i]
    return ' '
  })
  rest = rest.replace(/:where\([^()]*\)/g, ' ').replace(/:[\w-]+\([^()]*\)/g, ':x')
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\.[\w-]+/g) ?? []).length
  total[1] += (rest.match(/\[[^\]]*\]/g) ?? []).length
  total[1] += (rest.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length
  total[2] += (rest.match(/::[\w-]+/g) ?? []).length
  const types = rest.replace(/\[[^\]]*\]/g, ' ').replace(/::?[\w-]+/g, ' ').replace(/[.#][\w-]+/g, ' ')
  total[2] += (types.match(/(?:^|[\s>+~,])[a-zA-Z][\w-]*/g) ?? []).length
  return total
}

/* A selector list, split at the commas that separate selectors rather than the
 * ones inside `:is()`, `:not()` and `:has()`. */
export function splitSelectors(list) {
  const found = []
  let depth = 0
  let start = 0
  for (let index = 0; index < list.length; index += 1) {
    if (list[index] === '(') depth += 1
    else if (list[index] === ')') depth -= 1
    else if (list[index] === ',' && depth === 0) {
      found.push(list.slice(start, index).trim())
      start = index + 1
    }
  }
  found.push(list.slice(start).trim())
  return found
}
