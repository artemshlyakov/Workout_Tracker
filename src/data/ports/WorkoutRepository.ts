export interface WorkoutView {
  title: string
  workoutId?: string
  startedAt?: string
  exercises: { relationId: string; exerciseId: string; name: string; sets: { id: string; weight: string; reps: string; position: number }[] }[]
  active: boolean
}

export interface WorkoutDraftState {
  workoutId: string
  title: string
  dirty: boolean
  titleDirty?: boolean
  rows: Record<string, { id: string; weight: string; reps: string; position: number; saved: boolean; dirty: boolean }[]>
  restUntil: number | null
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
  | { kind: 'startWorkout'; operationId: string; workoutId: string; title: string; exerciseNames?: string[]; startedAt?: string }
  | { kind: 'reopenWorkout'; operationId: string; workoutId: string }
  | { kind: 'changeDate'; operationId: string; startedAt: string }
  | { kind: 'discardWorkout'; operationId: string }
  | { kind: 'removeExercise'; operationId: string; relationId: string }
  | { kind: 'moveExercise'; operationId: string; relationId: string; direction: -1 | 1 }
  | { kind: 'createExercise'; operationId: string; exerciseId: string; name: string }
  | { kind: 'archiveExercise'; operationId: string; exerciseId: string }
  | { kind: 'addExercise'; operationId: string; relationId: string; exerciseId: string }
  | { kind: 'saveSet'; operationId: string; id: string; relationId: string; weight: string; reps: string; position: number }
  | { kind: 'deleteSet'; operationId: string; id: string; relationId: string }
  | { kind: 'restoreSet'; operationId: string; id: string; relationId: string; weight: string; reps: string; position: number }

export interface TrainingPlanView { id: string; title: string; exerciseNames: string[] }
export interface BodyProfile { heightCm: number | null; bodyWeightKg: number | null }

export interface WorkoutRepository {
  listPlans(): Promise<TrainingPlanView[]>
  savePlan(input: TrainingPlanView, operationId: string): Promise<void>
  deletePlan(id: string, operationId: string): Promise<void>
  loadBodyProfile(): Promise<BodyProfile>
  saveBodyProfile(profile: BodyProfile): Promise<void>
  load(): Promise<WorkoutView>
  listJournal(): Promise<JournalView>
  apply(command: WorkoutCommand): Promise<void>
  loadDraft(): Promise<WorkoutDraftState | null>
  saveDraft(draft: WorkoutDraftState | null): Promise<void>
  exportData(): Promise<string>
  importData(json: string): Promise<WorkoutView>
}
