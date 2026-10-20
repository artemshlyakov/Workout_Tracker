import { describe, expect, it } from 'vitest'
import { addSet, initialSets, parseReps, parseWeight, removeSet, totalVolume, updateSet } from './workout'

describe('workout volume', () => {
  it('calculates the initial three sets', () => {
    expect(totalVolume(initialSets)).toBe(2270)
  })

  it('recalculates after editing a set', () => {
    expect(totalVolume(updateSet(initialSets, '2', 'reps', '10'))).toBe(2350)
    expect(totalVolume(updateSet(initialSets, '1', 'weight', '82,5'))).toBe(2295)
  })

  it('recalculates after adding a set', () => {
    const added = addSet(initialSets, '4')
    expect(added[3]).toEqual({ id: '4', weight: '75', reps: '' })
    expect(totalVolume(updateSet(added, '4', 'reps', '8'))).toBe(2870)
  })

  it('recalculates after deleting a set', () => {
    expect(totalVolume(removeSet(initialSets, '2'))).toBe(1550)
  })

  it('rejects negative weights and reps', () => {
    expect(parseWeight('-1')).toBeNull()
    expect(parseReps('-2')).toBeNull()
    expect(totalVolume(updateSet(initialSets, '1', 'weight', '-1'))).toBe(1470)
    expect(totalVolume(updateSet(initialSets, '1', 'reps', '-1'))).toBe(1470)
  })

  it('treats empty values as incomplete', () => {
    expect(parseWeight('')).toBeNull()
    expect(parseReps('  ')).toBeNull()
    expect(totalVolume(updateSet(initialSets, '1', 'weight', ''))).toBe(1470)
    expect(totalVolume(updateSet(initialSets, '1', 'reps', ''))).toBe(1470)
  })

  it('accepts decimal weights with a dot or comma', () => {
    expect(parseWeight('82.5')).toBe(82.5)
    expect(parseWeight('82,50')).toBe(82.5)
    expect(parseWeight('82.555')).toBeNull()
    expect(parseReps('2.5')).toBeNull()
  })
})
