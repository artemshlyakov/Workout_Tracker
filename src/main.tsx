import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthGate } from './features/auth/AuthGate'
import { PwaUpdate } from './app/PwaUpdate'
import { ErrorBoundary } from './app/ErrorBoundary'
import './shared/styles.css'


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><PwaUpdate /><AuthGate /></ErrorBoundary></React.StrictMode>,
)
