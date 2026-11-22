import {Component, type ErrorInfo, type ReactNode} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AutoPost UI error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md w-full space-y-4">
            <div className="space-y-1">
              <h1 className="text-base font-semibold text-slate-900">
                {this.props.fallbackTitle || 'Application Initialization Error'}
              </h1>
              <p className="text-xs text-slate-600 font-mono break-words">{this.state.error.message}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="h-9 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
              >
                Reload
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('autopost_api_base');
                  } catch {
                    // ignore storage errors
                  }
                  window.location.reload();
                }}
                className="h-9 px-3.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Reset Server URL
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const win = window as unknown as {
  __AUTOPOST_MOUNTING__?: boolean;
  __AUTOPOST_MOUNTED__?: boolean;
  __AUTOPOST_ROOT__?: Root;
};

if (!win.__AUTOPOST_MOUNTED__ && !win.__AUTOPOST_MOUNTING__) {
  win.__AUTOPOST_MOUNTING__ = true;
  try {
    const container = document.getElementById('root');
    if (container) {
      win.__AUTOPOST_ROOT__ = win.__AUTOPOST_ROOT__ || createRoot(container);
      win.__AUTOPOST_ROOT__.render(
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      );
      win.__AUTOPOST_MOUNTED__ = true;
    }
  } finally {
    if (!win.__AUTOPOST_MOUNTED__) {
      win.__AUTOPOST_MOUNTING__ = false;
    }
  }
}
