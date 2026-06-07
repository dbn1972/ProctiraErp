'use client';

/**
 * Top header bar for the developer portal dashboard.
 */
export function Header() {
  return (
    <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-6">
      <div className="flex items-center gap-4">
        <h2 className="text-lg font-semibold text-gray-800">Developer Portal</h2>
      </div>
      <div className="flex items-center gap-4">
        <button
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50 transition-colors"
          aria-label="View documentation"
        >
          Docs
        </button>
        <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
          <span className="text-sm font-medium text-primary-700" aria-label="User avatar">D</span>
        </div>
      </div>
    </header>
  );
}
