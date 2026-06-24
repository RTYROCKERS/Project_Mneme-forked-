import { Component } from 'react';

/**
 * Catches render-time errors anywhere in the tree and shows a recoverable
 * fallback instead of a blank white screen.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled UI error:', error, info);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--bg-base)] p-6 text-center">
          <h1 className="text-lg font-semibold text-[var(--text-primary)]">Something went wrong</h1>
          <p className="max-w-sm text-sm text-[var(--text-muted)]">
            An unexpected error occurred while rendering this page. You can try again or go back to your dashboard.
          </p>
          <div className="flex gap-3">
            <button
              onClick={this.handleReset}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Try again
            </button>
            <a
              href="/dashboard"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
            >
              Go to dashboard
            </a>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
