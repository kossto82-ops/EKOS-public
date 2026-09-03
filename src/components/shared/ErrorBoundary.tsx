/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Component, ErrorInfo, ReactNode, useContext } from 'react';
import { AlertTriangle } from 'lucide-react';
import { reportError } from '../../utils/telemetry';
import { LocaleContext } from '../../context/LocaleContext';
import { en } from '../../locales/en';

// The boundary itself must be a class component (getDerivedStateFromError /
// componentDidCatch have no hook equivalents), so the localized fallback UI is
// factored into this functional sub-component that reads the locale.
//
// It reads LocaleContext directly (rather than via the throwing useLocale hook)
// and degrades to English if no provider is present: an error boundary is a
// last-resort safety net that must render even when the surrounding provider
// tree — including LocaleProvider itself — is what failed or is absent.
const ErrorBoundaryFallback: React.FC<{
  error: Error | null;
  onReset: () => void;
  onReload: () => void;
}> = ({ error, onReset, onReload }) => {
  const ctx = useContext(LocaleContext);
  const t = ctx?.t ?? ((path: string): string =>
    (path.split('.').reduce<any>((v, k) => (v == null ? v : v[k]), en) as string) ?? path);
  return (
    <div role="alert" aria-labelledby="error_boundary_title" className="flex flex-col items-center justify-center p-6 min-h-[400px] w-full animate-fadeIn">
      <div className="w-full max-w-md rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm text-left space-y-4">
        <div className="flex items-start gap-3.5">
          <div className="p-2 bg-warning-50 dark:bg-warning-950/30 text-warning-600 dark:text-warning-400 rounded-lg shrink-0 border border-warning-100 dark:border-warning-900/40">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="space-y-1.5 flex-1 min-w-0">
            <h4 id="error_boundary_title" className="text-sm font-bold text-slate-900 dark:text-zinc-100 tracking-tight">
              {t('errorBoundary.title')}
            </h4>
            <p className="text-xs text-slate-500 dark:text-zinc-400 leading-relaxed font-medium">
              {t('errorBoundary.body')}
            </p>
            <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-950 rounded-lg border border-slate-100 dark:border-slate-900 overflow-x-auto max-h-32">
              <p className="text-3xs font-mono text-slate-600 dark:text-zinc-400 whitespace-pre-wrap leading-normal">
                {error?.message || t('errorBoundary.noMessage')}
              </p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2.5 pt-3 border-t border-slate-100 dark:border-slate-800">
          <button
            type="button"
            onClick={onReset}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-800 text-2xs font-bold text-slate-600 dark:text-zinc-300 hover:bg-slate-50 dark:hover:bg-slate-950 active:bg-slate-100 dark:active:bg-slate-900 transition-colors cursor-pointer"
          >
            {t('errorBoundary.reset')}
          </button>
          <button
            type="button"
            onClick={onReload}
            className="px-3.5 py-1.5 rounded-lg bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-2xs font-bold text-white transition-colors cursor-pointer shadow-xs"
          >
            {t('errorBoundary.reload')}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ErrorBoundaryProps {
  children?: ReactNode;
  fallback?: ReactNode;
  /** When any value in this array changes, a caught error is cleared so the
   *  boundary re-renders its children (e.g. pass [activeTab] to recover on
   *  navigation instead of trapping the user on the error screen). */
  resetKeys?: unknown[];
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null
    };
  }

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  public componentDidUpdate(prevProps: ErrorBoundaryProps) {
    // Auto-recover when the reset keys change (e.g. the user navigated to a
    // different tab), so a one-off render error doesn't strand them.
    if (!this.state.hasError) return;
    const prev = prevProps.resetKeys;
    const next = this.props.resetKeys;
    if (prev && next && (prev.length !== next.length || next.some((k, i) => k !== prev[i]))) {
      this.setState({ hasError: false, error: null });
    }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError({
      type: 'react_error_boundary',
      message: error.message,
      stack: error.stack,
      context: { componentStack: errorInfo.componentStack ?? undefined },
    });
  }

  public handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ErrorBoundaryFallback
          error={this.state.error}
          onReset={() => this.setState({ hasError: false, error: null })}
          onReload={this.handleReload}
        />
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
