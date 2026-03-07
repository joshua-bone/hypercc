import React from 'react'
import ReactDOM from 'react-dom/client'
import DemoShell from './DemoShell'
import './grid45/ui/grid45.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DemoShell initialDemo="grid45" />
  </React.StrictMode>,
)
