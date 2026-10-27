import { useMemo } from 'react'

export interface TrendPoint { day: string; value: number }
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 })
const dayLabel = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short' })

export function TrendChart({ points, unit, label, tone = 'info' }: { points: TrendPoint[]; unit: string; label: string; tone?: 'info' | 'action' }) {
  const coordinates = useMemo(() => {
    const visible = points.slice(-30)
    const times = visible.map((point) => new Date(`${point.day}T12:00:00`).getTime())
    const first = times[0], last = times.at(-1)
    const minimum = Math.min(...visible.map((point) => point.value))
    const maximum = Math.max(...visible.map((point) => point.value))
    const floor = Math.max(0, Math.floor(minimum * .9 / 5) * 5)
    const ceiling = Math.max(floor + 5, Math.ceil(maximum * 1.05 / 5) * 5)
    const values = visible.map((point, index) => ({ ...point,
      x: first === last ? 194 : 48 + (times[index] - first) / (last! - first!) * 292,
      y: 154 - (point.value - floor) / (ceiling - floor) * 132,
    }))
    return { values, floor, ceiling }
  }, [points])
  if (!points.length) return null
  const { values, floor, ceiling } = coordinates
  const path = values.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ')
  const firstDay = dayLabel.format(new Date(`${values[0].day}T12:00:00`))
  const lastDay = dayLabel.format(new Date(`${values.at(-1)!.day}T12:00:00`))
  return <figure className={`trend-chart trend-chart--${tone}`} aria-label={`${label}: ${values.length} дней с записями, от ${firstDay} до ${lastDay}. Последнее значение ${number.format(values.at(-1)!.value)} ${unit}`}>
    <svg viewBox="0 0 360 200" role="img" aria-hidden="true" preserveAspectRatio="xMidYMid meet">
      {[0, 1, 2].map((step) => { const y = 22 + step * 66; const value = ceiling - (ceiling - floor) * step / 2; return <g key={step}><line className="trend-chart__grid" x1="48" x2="340" y1={y} y2={y} /><text className="trend-chart__axis" x="39" y={y + 4} textAnchor="end">{compact.format(value)}</text></g> })}
      {values.length > 1 && <path className="trend-chart__area" d={`${path} L ${values.at(-1)!.x.toFixed(1)} 154 L ${values[0].x.toFixed(1)} 154 Z`} />}
      {values.length > 1 && <path className="trend-chart__line" d={path} />}
      {values.map((point, index) => <circle className="trend-chart__point" key={point.day} cx={point.x} cy={point.y} r={index === values.length - 1 ? 5 : 3.5}><title>{`${dayLabel.format(new Date(`${point.day}T12:00:00`))}: ${number.format(point.value)} ${unit}`}</title></circle>)}
      <text className="trend-chart__date" x={values.length === 1 ? 194 : 48} y="189" textAnchor={values.length === 1 ? 'middle' : 'start'}>{firstDay}</text>
      {values.length > 1 && <text className="trend-chart__date" x="340" y="189" textAnchor="end">{lastDay}</text>}
    </svg>
    <figcaption>{values.length === 1 ? 'Первая запись — начало графика' : `${values.length} дней с записями · последнее значение ${number.format(values.at(-1)!.value)} ${unit}`}</figcaption>
  </figure>
}
