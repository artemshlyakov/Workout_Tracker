import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthGate } from './features/auth/AuthGate'
import { registerSW } from 'virtual:pwa-register'
import './shared/styles.css'

registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><AuthGate /></React.StrictMode>,
)
