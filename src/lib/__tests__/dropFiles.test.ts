import { readFileSync } from 'fs'
import { saveDropped, quotePath } from '../dropFiles'

test('saves dropped files under short, readable names without overwriting', () => {
  const name = `report-${Date.now()}.txt`
  const [a] = saveDropped([{ name, data: Buffer.from('one').toString('base64') }])
  const [b] = saveDropped([{ name: `../../${name}`, data: Buffer.from('two').toString('base64') }])
  expect(a).toBe(`/tmp/polyergon/${name}`)
  expect(b).toBe(`/tmp/polyergon/${name.replace('.txt', '-2.txt')}`)
  expect(readFileSync(b, 'utf-8')).toBe('two')
  expect(quotePath('/tmp/polyergon/my file.pdf')).toBe("'/tmp/polyergon/my file.pdf'")
})
