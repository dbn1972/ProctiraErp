'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { unstable_rethrow } from 'next/navigation';

/**
 * PageErrorBoundary — Recoverable error boundary for dashboard pages.
 *
 * Wraps page-level content inside the authenticated shell so that a render
 * error in any page does NOT crash the sidebar, header, or shell chrome.
 * Instead, it renders a user-friendly error UI with a "Retry" button that
 * resets the boundary and re-renders the child tree.
 *
 * Design: Property F-9 — Error Boundary Recovery
 * Validates: Requirements 24.x, 38.7
 */

interface PageErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback to render instead of the default error UI. */
  fallback?: ReactNode;
}

interface PageErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PageErrorBoundary extends Component<PageErrorBoundaryProps, PageErrorBoundaryState> {
  constructor(props: PageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PageErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log to structured logging in production; here we just console.error
    // so the error is visible in dev tools and test output.
    console.error('[PageErrorBoundary] Caught render error:', error, errorInfo);
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // notFound() / redirect() from a streamed server page surface here as
      // thrown errors; hand them back to Next so its not-found / redirect
      // boundaries render instead of the generic fallback (G-905 finding).
      if (this.state.error) unstable_rethrow(this.state.error);

      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div
          role="alert"
          aria-live="assertive"
          data-testid="page-error-boundary"
          className="flex flex-col items-center justify-center gap-4 p-8 text-center"
        >
          <div className="rounded-full bg-destructive/10 p-3">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 text-destructive"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold">Something went wrong</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            An unexpected error occurred while rendering this page. The rest of the application is
            still functional.
          </p>
          {this.state.error && (
            <details className="max-w-md text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer">Error details</summary>
              <pre className="mt-2 overflow-auto rounded bg-muted p-2">
                {this.state.error.message}
              </pre>
            </details>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            data-testid="error-boundary-retry"
            className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default PageErrorBoundary;
