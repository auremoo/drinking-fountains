// Drinking Fountains — Auteur : Aurélien Moote - Moo - 2026 — Licence MIT
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { installGlobalErrorLogging } from './utils/errorLog.js'
import {
  dropLegacyTileCache,
  installChunkErrorRecovery,
} from './utils/appReset.js'

// Leaflet's stylesheet must be imported before any map renders.
import 'leaflet/dist/leaflet.css'
import './styles.css'

// Record anything that escapes React, and self-heal after a stale deployment,
// before the first component mounts.
installGlobalErrorLogging()
installChunkErrorRecovery()
dropLegacyTileCache()

const container = document.getElementById('root')

if (container) {
  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </React.StrictMode>,
  )
}
