import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// Fonts are bundled from npm at build time; the app never downloads fonts at runtime.
import '@fontsource-variable/fraunces'
import '@fontsource-variable/source-sans-3'
import './styles/tokens.css'
import './styles/global.css'
import { App } from './App'

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
