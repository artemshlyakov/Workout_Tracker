import React from 'react'
import ReactDOM from 'react-dom/client'
import { AuthGate } from './features/auth/AuthGate'
import { PwaUpdate } from './app/PwaUpdate'
import { ErrorBoundary } from './app/ErrorBoundary'
import './shared/styles.css'

// iOS Safari ignores viewport scaling limits for page gestures. Keep the PWA
// viewport fixed while leaving system text sizing and Accessibility Zoom alone.
const preventPagePinch = (event: Event) => event.preventDefault()
document.addEventListener('gesturestart', preventPagePinch, { passive: false })
document.addEventListener('gesturechange', preventPagePinch, { passive: false })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><ErrorBoundary><PwaUpdate /><AuthGate /></ErrorBoundary></React.StrictMode>,
)
