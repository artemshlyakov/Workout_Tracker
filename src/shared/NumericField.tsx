import type { Ref } from 'react'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  invalid: boolean
  kind: 'weight' | 'reps'
  inputRef?: Ref<HTMLInputElement>
}

export function NumericField({ id, label, value, onChange, invalid, kind, inputRef }: Props) {
  return <div className="numeric-field">
    <label htmlFor={id}>{label}</label>
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode={kind === 'weight' ? 'decimal' : 'numeric'}
      autoComplete="off"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={invalid}
      aria-describedby={invalid ? `${id}-error` : undefined}
      placeholder={kind === 'weight' ? '0,0' : '0'}
    />
    {invalid && <span className="field-error" id={`${id}-error`} role="alert">
      {kind === 'weight' ? 'Вес: от 0 до 2000, до 2 знаков' : 'Повторы: целое число от 1 до 1000'}
    </span>}
  </div>
}
