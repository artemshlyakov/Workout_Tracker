import { Component, type ReactNode } from 'react'
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="app-shell"><section className="empty-panel"><h1>Не удалось открыть экран</h1><p>Сохранённые записи остаются на устройстве. Перезагрузите приложение.</p><button className="button button--primary" onClick={() => location.reload()}>Перезагрузить</button></section></main> : this.props.children
  }
}
