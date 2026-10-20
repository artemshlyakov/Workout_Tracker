import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './app/App'
import { DexieWorkoutRepository } from './data/local/DexieWorkoutRepository'
import { registerSW } from 'virtual:pwa-register'
import './shared/styles.css'

const repository = new DexieWorkoutRepository()
registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App repository={repository} /></React.StrictMode>,
)
