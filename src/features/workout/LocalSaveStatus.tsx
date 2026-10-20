interface Props {
  pending: number
  error: string | null
  invalid: boolean
  onRetry: () => void
}

export function LocalSaveStatus({ pending, error, invalid, onRetry }: Props) {
  const message = invalid ? 'Исправьте значения — изменения не сохранены' : error ? `Не удалось сохранить: ${error}` :
    pending > 0 ? 'Сохранение на устройстве…' : 'Сохранено на устройстве · ожидает синхронизации'
  return <div className={`local-status ${invalid || error ? 'local-status--error' : ''}`} role="status" aria-live="polite">
    <span className="demo-status__dot" aria-hidden="true" />
    <span>{message}</span>
    {error && !invalid && <button className="retry-button" type="button" onClick={onRetry}>Повторить</button>}
  </div>
}
