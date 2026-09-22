import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { CourseProvider } from './state'
import { ToastProvider } from './toast'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <CourseProvider>
        <App />
      </CourseProvider>
    </ToastProvider>
  </React.StrictMode>,
)
