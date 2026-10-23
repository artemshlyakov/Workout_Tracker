export interface WorkoutView {
  title: string
  exerciseName?: string
  sets: { id: string; weight: string; reps: string; position: number }[]
  active?: boolean
}

export interface JournalEntry {
  id: string
  title: string
  startedAt: string
  completedAt: string | null
  exercises: { id: string; name: string; sets: { weight: number; reps: number }[] }[]
}

export interface JournalView {
  workouts: JournalEntry[]
  exercises: { id: string; name: string }[]
}

export type WorkoutCommand =
  | { kind: 'rename'; operationId: string; title: string }
  | { kind: 'finishWorkout'; operationId: string }
  | { kind: 'startWorkout'; operationId: string; relationOperationId: string; workoutId: string; relationId: string }
  | { kind: 'saveSet'; operationId: string; id: string; weight: string; reps: string; position: number }
  | { kind: 'deleteSet'; operationId: string; id: string }
  | { kind: 'restoreSet'; operationId: string; id: string; weight: string; reps: string; position: number }

export interface WorkoutRepository {
  load(): Promise<WorkoutView>
  listJournal(): Promise<JournalView>
  apply(command: WorkoutCommand): Promise<void>
  exportData(): Promise<string>
  importData(json: string): Promise<WorkoutView>
}
