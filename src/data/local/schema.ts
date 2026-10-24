import Dexie, { type Table } from 'dexie'
import type { WorkoutDraftState } from '../ports/WorkoutRepository'

export const DEV_WORKSPACE_ID = '00000000-0000-4000-8000-000000000001'
export const BACKUP_VERSION = 1

export interface Workspace {
  id: string
  mode: 'dev_test' | 'authenticated'
  ownerUserId: string | null
  createdAt: string
  lastActiveAt: string
  draft?: WorkoutDraftState | null
  importedCopies?: string[]
  heightCm?: number | null
  bodyWeightKg?: number | null
}

interface RecordMeta {
  id: string
  workspaceId: string
  ownerUserId: string | null
  serverRevision: number | null
  localRevision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface WorkoutRecord extends RecordMeta {
  title: string
  startedAt: string
  completedAt: string | null
  editingCompletedAt?: string
}

export interface TrainingPlanRecord extends RecordMeta { title: string; exerciseNames: string[] }
export interface ExerciseRecord extends RecordMeta { name: string }
export interface WorkoutExerciseRecord extends RecordMeta {
  workoutId: string
  exerciseId: string
  position: number
}
export interface ExerciseSetRecord extends RecordMeta {
  workoutExerciseId: string
  position: number
  weightCentiKg: number
  reps: number
}
export interface OutboxOperation {
  sequence?: number
  operationId: string
  workspaceId: string
  ownerUserId: string | null
  entityType: 'workout' | 'exercise' | 'workoutExercise' | 'exerciseSet' | 'trainingPlan'
  entityId: string
  action: 'upsert' | 'delete'
  snapshot: WorkoutRecord | ExerciseRecord | WorkoutExerciseRecord | ExerciseSetRecord | TrainingPlanRecord
  baseServerRevision: number | null
  status: 'pending' | 'conflict'
  attempts: number
  lastError: string | null
  createdAt: string
}
export interface SyncState {
  workspaceId: string
  ownerUserId: string | null
  cursor: string | null
  lastAckAt: string | null
}

export interface DevBackup {
  format: 'workout-tracker-dev-backup'
  version: 1
  workspace: Workspace
  workouts: WorkoutRecord[]
  exercises: ExerciseRecord[]
  workoutExercises: WorkoutExerciseRecord[]
  exerciseSets: ExerciseSetRecord[]
  trainingPlans?: TrainingPlanRecord[]
  outbox: OutboxOperation[]
  syncState: SyncState
}

export class WorkoutDatabase extends Dexie {
  workspaces!: Table<Workspace, string>
  workouts!: Table<WorkoutRecord, string>
  trainingPlans!: Table<TrainingPlanRecord, string>
  exercises!: Table<ExerciseRecord, string>
  workoutExercises!: Table<WorkoutExerciseRecord, string>
  exerciseSets!: Table<ExerciseSetRecord, string>
  outbox!: Table<OutboxOperation, number>
  syncState!: Table<SyncState, string>

  constructor(name = 'workout-tracker-dev-v1') {
    super(name)
    this.version(1).stores({
      workspaces: 'id',
      workouts: 'id, workspaceId',
      exercises: 'id, workspaceId',
      workoutExercises: 'id, workspaceId, workoutId, exerciseId',
      exerciseSets: 'id, workspaceId, workoutExerciseId',
      outbox: '++sequence, &operationId, workspaceId, entityId, createdAt',
      syncState: 'workspaceId',
    })
    this.version(2).stores({
      workspaces: 'id', workouts: 'id, workspaceId', exercises: 'id, workspaceId',
      workoutExercises: 'id, workspaceId, workoutId, exerciseId', exerciseSets: 'id, workspaceId, workoutExerciseId',
      trainingPlans: 'id, workspaceId', outbox: '++sequence, &operationId, workspaceId, entityId, createdAt', syncState: 'workspaceId',
    })
  }
}
