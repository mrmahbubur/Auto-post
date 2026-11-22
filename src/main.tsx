import {Component, type ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{children: ReactNode}, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md w-full space-y-3">
            <h1 className="text-base font-semibold text-slate-900">Application Error</h1>
            <p className="text-xs text-slate-600 font-mono break-words">{this.state.error.message}</p>
            <button
              onClick={() => window.location.reload()}
              className="h-9 px-4 text-xs font-medium text-white bg-slate-900 rounded-lg cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const win = window as unknown as { __AUTOPOST_MOUNTED__?: boolean };
if (!win.__AUTOPOST_MOUNTED__) {
  win.__AUTOPOST_MOUNTED__ = true;
  createRoot(document.getElementById('root')!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}
