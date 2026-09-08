'use client';

interface StatusMessageProps {
  type: 'success' | 'error' | 'info';
  title: string;
  message: string;
  latencyMs?: number;
  onRetry?: () => void;
}

export function StatusMessage({ type, title, message, latencyMs, onRetry }: StatusMessageProps) {
  const styles = {
    success: 'border-green-200 bg-green-50 text-green-800',
    error: 'border-red-200 bg-red-50 text-red-800',
    info: 'border-blue-200 bg-blue-50 text-blue-800',
  };

  const icons = {
    success: (
      <svg
        className="h-5 w-5 text-green-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    error: (
      <svg
        className="h-5 w-5 text-red-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
    info: (
      <svg
        className="h-5 w-5 text-blue-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  };

  return (
    <div
      className={`rounded-md border p-4 ${styles[type]}`}
      role={type === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">{icons[type]}</div>
        <div className="flex-1">
          <h4 className="text-sm font-medium">{title}</h4>
          <p className="mt-1 text-sm opacity-90">{message}</p>
          {latencyMs !== undefined && (
            <p className="mt-1 text-xs opacity-70">Response time: {latencyMs}ms</p>
          )}
          {type === 'error' && onRetry && (
            <button
              onClick={onRetry}
              className="mt-2 text-sm font-medium underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 rounded"
              type="button"
            >
              Retry configuration
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
