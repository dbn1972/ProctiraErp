/**
 * @vitest-environment jsdom
 *
 * Unit tests for PageErrorBoundary component.
 *
 * Property F-9: Error Boundary Recovery
 * **Validates: Requirements 24.x, 38.7**
 *
 * Verifies that:
 * 1. The error boundary catches render errors from children
 * 2. It renders a recoverable UI with a "Retry" button
 * 3. Clicking Retry resets the boundary and re-renders children
 * 4. The error boundary does not affect sibling components (shell chrome)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { PageErrorBoundary } from './PageErrorBoundary';

// Suppress console.error from React's error boundary logging during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PageErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <PageErrorBoundary>
        <div data-testid="child-content">Hello World</div>
      </PageErrorBoundary>,
    );

    expect(screen.getByTestId('child-content')).toBeDefined();
    expect(screen.getByTestId('child-content').textContent).toBe('Hello World');
    expect(screen.queryByTestId('page-error-boundary')).toBeNull();
  });

  it('catches render errors and displays error UI', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Test render error');
    }

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    // Error boundary UI should be rendered
    expect(screen.getByTestId('page-error-boundary')).toBeDefined();
    expect(screen.getByRole('alert')).toBeDefined();
    expect(screen.getByText('Something went wrong')).toBeDefined();
  });

  it('displays a Retry button in the error UI', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Test render error');
    }

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    const retryButton = screen.getByTestId('error-boundary-retry');
    expect(retryButton).toBeDefined();
    expect(retryButton.textContent).toBe('Retry');
    expect(retryButton.getAttribute('type')).toBe('button');
  });

  it('recovers when Retry is clicked and child no longer throws', () => {
    let shouldThrow = true;

    function ConditionalThrow(): React.ReactElement {
      if (shouldThrow) {
        throw new Error('Conditional render error');
      }
      return <div data-testid="recovered-content">Recovered!</div>;
    }

    render(
      <PageErrorBoundary>
        <ConditionalThrow />
      </PageErrorBoundary>,
    );

    // Error boundary should be showing
    expect(screen.getByTestId('page-error-boundary')).toBeDefined();

    // Fix the error condition
    shouldThrow = false;

    // Click Retry
    act(() => {
      fireEvent.click(screen.getByTestId('error-boundary-retry'));
    });

    // After retry, the recovered content should be visible
    expect(screen.getByTestId('recovered-content')).toBeDefined();
    expect(screen.getByTestId('recovered-content').textContent).toBe('Recovered!');
    expect(screen.queryByTestId('page-error-boundary')).toBeNull();
  });

  it('does not affect sibling components (simulating shell chrome)', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Page error');
    }

    // Simulate the shell structure: sidebar + main content with error boundary
    render(
      <div data-testid="shell">
        <nav data-testid="sidebar">Sidebar Navigation</nav>
        <main>
          <PageErrorBoundary>
            <ThrowingComponent />
          </PageErrorBoundary>
        </main>
      </div>,
    );

    // Sidebar should still be mounted
    expect(screen.getByTestId('sidebar')).toBeDefined();
    expect(screen.getByTestId('sidebar').textContent).toBe('Sidebar Navigation');

    // Shell should still be mounted
    expect(screen.getByTestId('shell')).toBeDefined();

    // Error boundary should be showing inside main
    expect(screen.getByTestId('page-error-boundary')).toBeDefined();
  });

  it('has proper accessibility attributes on the error UI', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Accessibility test error');
    }

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    const errorUI = screen.getByTestId('page-error-boundary');
    expect(errorUI.getAttribute('role')).toBe('alert');
    expect(errorUI.getAttribute('aria-live')).toBe('assertive');
  });

  it('shows error details in a collapsible section', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Detailed error message for debugging');
    }

    render(
      <PageErrorBoundary>
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    // Error details should be present (in a <details> element)
    expect(screen.getByText('Error details')).toBeDefined();

    // The error message should be in the details
    expect(screen.getByText('Detailed error message for debugging')).toBeDefined();
  });

  it('renders custom fallback when provided', () => {
    function ThrowingComponent(): React.ReactElement {
      throw new Error('Custom fallback test');
    }

    render(
      <PageErrorBoundary
        fallback={<div data-testid="custom-fallback">Custom Error UI</div>}
      >
        <ThrowingComponent />
      </PageErrorBoundary>,
    );

    expect(screen.getByTestId('custom-fallback')).toBeDefined();
    expect(screen.queryByTestId('page-error-boundary')).toBeNull();
  });
});
