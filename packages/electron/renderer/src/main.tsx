import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConnectionGate } from './components/ConnectionGate';
import { ToastProvider } from './components/Toast';
import './index.css';

// Force dark mode always — no light mode support.
document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <ConnectionGate />
    </ToastProvider>
  </React.StrictMode>,
);
