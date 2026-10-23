import { useEffect, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import { Button } from '../shared/Button'
let update: ((reload?: boolean) => Promise<void>) | undefined
export function PwaUpdate() {
  const [available, setAvailable] = useState(false)
  const [workoutOpen, setWorkoutOpen] = useState(false)
  useEffect(() => {
    update = registerSW({ immediate: true, onNeedRefresh: () => setAvailable(true) })
    const onWorkout = (event: Event) => setWorkoutOpen(Boolean((event as CustomEvent<boolean>).detail))
    window.addEventListener('workout-active', onWorkout)
    return () => window.removeEventListener('workout-active', onWorkout)
  }, [])
  if (!available) return null
  return <aside className="update-banner" role="status"><span>{workoutOpen ? 'Новая версия готова. Обновите после завершения тренировки.' : 'Доступна новая версия приложения.'}</span><Button disabled={workoutOpen} onClick={() => void update?.(true)}>Обновить</Button></aside>
}
