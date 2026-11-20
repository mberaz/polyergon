import { parseNotesTick } from '../meetingAssistant'

describe('parseNotesTick', () => {
  const valid = {
    notes: { topics: ['roadmap'], decisions: ['ship Friday'], actionItems: ['Dana: send doc'] },
    suggestion: 'The Q3 number mentioned is on the dashboard',
  }

  test('parses clean JSON', () => {
    expect(parseNotesTick(JSON.stringify(valid))).toEqual(valid)
  })

  test('parses JSON wrapped in markdown fences', () => {
    expect(parseNotesTick('```json\n' + JSON.stringify(valid) + '\n```')).toEqual(valid)
  })

  test('parses JSON with surrounding prose', () => {
    expect(parseNotesTick('Here are the notes:\n' + JSON.stringify(valid) + '\nLet me know!')).toEqual(valid)
  })

  test('null suggestion stays null', () => {
    const r = parseNotesTick(JSON.stringify({ notes: valid.notes, suggestion: null }))
    expect(r.suggestion).toBeNull()
    expect(r.notes).toEqual(valid.notes)
  })

  test('empty-string suggestion becomes null', () => {
    expect(parseNotesTick(JSON.stringify({ notes: valid.notes, suggestion: '  ' })).suggestion).toBeNull()
  })

  test('non-string array entries are filtered out', () => {
    const r = parseNotesTick(JSON.stringify({ notes: { topics: ['a', 42, null], decisions: [], actionItems: [] }, suggestion: null }))
    expect(r.notes).toEqual({ topics: ['a'], decisions: [], actionItems: [] })
  })

  test('missing arrays default to empty', () => {
    const r = parseNotesTick(JSON.stringify({ notes: { topics: ['a'] }, suggestion: null }))
    expect(r.notes).toEqual({ topics: ['a'], decisions: [], actionItems: [] })
  })

  test('garbage returns nulls instead of throwing', () => {
    expect(parseNotesTick('I could not produce notes')).toEqual({ notes: null, suggestion: null })
    expect(parseNotesTick('{broken json')).toEqual({ notes: null, suggestion: null })
    expect(parseNotesTick('')).toEqual({ notes: null, suggestion: null })
  })
})
