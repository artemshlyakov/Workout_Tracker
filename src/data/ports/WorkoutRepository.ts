export interface WorkoutView {
  title: string
  sets: { id: string; weight: string; reps: string; position: number }[]
}

export type WorkoutCommand =
  | { kind: 'rename'; operationId: string; title: string }
  | { kind: 'saveSet'; operationId: string; id: string; weight: string; reps: string; position: number }
  | { kind: 'deleteSet'; operationId: string; id: string }
  | { kind: 'restoreSet'; operationId: string; id: string; weight: string; reps: string; position: number }

export interface WorkoutRepository {
  load(): Promise<WorkoutView>
  apply(command: WorkoutCommand): Promise<void>
  exportData(): Promise<string>
  importData(json: string): Promise<WorkoutView>
}
