import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/app'
import { RootErrorBoundary } from './app/error-boundary'
import { installGlobalErrorHandlers } from './lib/report-error'
import { AppProviders } from './providers/app-providers'
import './styles/globals.css'

installGlobalErrorHandlers()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RootErrorBoundary>
      <AppProviders>
        <App />
      </AppProviders>
    </RootErrorBoundary>
  </StrictMode>
)
