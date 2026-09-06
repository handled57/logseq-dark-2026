import vm from 'node:vm'
import { readFile } from 'node:fs/promises'

export async function classicScript(path) {
  return new vm.Script(await readFile(path, 'utf8'))
}
