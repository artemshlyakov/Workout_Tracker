import type { WorkoutCommand } from '../data/ports/WorkoutRepository'
import type { WorkoutSet } from './workout'

/** A server tombstone is final for its UUID; undo creates a new entity. */
export function undoDeletedSet(set: WorkoutSet, position: number): { set: WorkoutSet; command: Extract<WorkoutCommand, { kind: 'saveSet' }> } {
  const restored = { ...set, id: crypto.randomUUID() }
  return {
    set: restored,
    command: { kind: 'saveSet', operationId: crypto.randomUUID(), ...restored, position },
  }
}
