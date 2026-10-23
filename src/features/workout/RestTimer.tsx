import { useEffect, useState } from 'react'
import { Button } from '../../shared/Button'
export function RestTimer({ until, onChange }: { until: number | null; onChange: (time: number | null) => void }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  const seconds = until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0
  return <section className={`rest-timer ${until && seconds === 0 ? 'rest-timer--done' : ''}`} aria-label="Таймер отдыха"><div><span className="eyebrow">ОТДЫХ</span><strong>{until ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Готовы к подходу?'}</strong>{until && seconds === 0 && <span role="status">Отдых завершён</span>}</div>{until ? <div className="timer-actions"><Button variant="quiet" onClick={() => onChange(Math.max(Date.now(), until) + 30000)}>+30 с</Button><Button variant="quiet" onClick={() => onChange(null)} aria-label="Остановить таймер">×</Button></div> : <div className="timer-actions">{[60, 90, 120].map((duration) => <Button variant="quiet" key={duration} onClick={() => onChange(Date.now() + duration * 1000)}>{duration} с</Button>)}</div>}</section>
}
