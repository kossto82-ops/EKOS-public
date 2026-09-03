import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LocaleProvider } from './context/LocaleContext';
import { BrandProvider } from './context/BrandContext';
import { DepartmentProvider } from './context/DepartmentContext';
import { AuthProvider } from './context/AuthContext';
import { BreadcrumbProvider } from './context/BreadcrumbContext';
import { reportError } from './utils/telemetry';
import './index.css';

// Silence benign Vite HMR WebSocket errors when HMR is disabled in AI Studio,
// and report every other uncaught error/rejection through the telemetry seam
// (see src/utils/telemetry.ts) — previously these just vanished into the
// browser console with no structured record, which is the same gap
// docs/KNOWN_LIMITATIONS.md's "Infrastructure Observability" item describes.
if (typeof window !== 'undefined') {
  const isWebsocketError = (msg: string) => {
    return msg.includes('WebSocket') ||
           msg.includes('websocket') ||
           msg.includes('WebSocket closed without opened');
  };

  window.addEventListener('unhandledrejection', (event) => {
    const errorMsg = event.reason?.message || String(event.reason || '');
    if (isWebsocketError(errorMsg)) {
      event.preventDefault();
      console.warn('Ignored benign Vite WebSocket HMR rejection:', errorMsg);
      return;
    }
    reportError({ type: 'unhandled_rejection', message: errorMsg, stack: event.reason?.stack });
  });

  window.addEventListener('error', (event) => {
    const errorMsg = event.message || '';
    if (isWebsocketError(errorMsg)) {
      event.preventDefault();
      console.warn('Ignored benign Vite WebSocket HMR error:', errorMsg);
      return;
    }
    reportError({ type: 'window_error', message: errorMsg, stack: event.error?.stack });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LocaleProvider>
      <AuthProvider>
        <BrandProvider>
          <DepartmentProvider>
            <BreadcrumbProvider>
              <App />
            </BreadcrumbProvider>
          </DepartmentProvider>
        </BrandProvider>
      </AuthProvider>
    </LocaleProvider>
  </StrictMode>,
);

