// Drinking Fountains — Auteur : Aurélien Moote - Moo - 2026 — Licence MIT
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

// Leaflet's stylesheet must be imported before any map renders.
import 'leaflet/dist/leaflet.css'
import './styles.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
