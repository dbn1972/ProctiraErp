/**
 * @vitest-environment jsdom
 *
 * Property-Based Test: F-9 Error Boundary Recovery
 *
 * **Validates: Requirements 24.x, 38.7**
 *
 * Property F-9: For any page `p` in the authenticated dashboard, `p` SHALL
 * be wrapped by a `PageErrorBoundary` that renders a recoverable error UI
 * exposing a Retry action; failures inside `p` SHALL NOT crash the dashboard
 * shell or unmount the sidebar.
 *
 * This property test uses fast-check to generate arbitrary error messages
 * and verify that:
 * 1. ANY error thrown during render is caught by the boundary
 * 2. The error UI always renders with the correct structure (Retry button,
 *    role="alert", aria-live="assertive")
 * 3. Sibling components (simulating shell chrome) are NEVER unmounted
 * 4. Clicking Retry always resets the boundary state
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import React from 'react';
import fc from 'fast-check';
import { PageErrorBoundary } from './PageErrorBoundary';

// Suppress console.error from React's error boundary logging during tests
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('Property F-9: Error Boundary Recovery', () => {
  it('for any error message, the boundary catches the error and renders recoverable UI', () => {
    fc.assert(
      fc.property(
        // Generate arbitrary non-empty error messages
        fc.string({ minLength: 1, maxLength: 500 }),
        (errorMessage) => {
          cleanup();

          // Create a component that throws with the generated message
          function ThrowingPage(): React.ReactElement {
            throw new Error(errorMessage);
          }

          // Render inside a simulated shell structure
          render(
            <div data-testid="shell-container">
              <nav data-testid="sidebar-nav">Sidebar</nav>
              <header data-testid="shell-header">Header</header>
              <main>
                <PageErrorBoundary>
                  <ThrowingPage />
                </PageErrorBoundary>
              </main>
            </div>,
          );

          // PROPERTY 1: Error boundary UI is always rendered
          const errorUI = screen.getByTestId('page-error-boundary');
          expect(errorUI).toBeDefined();

          // PROPERTY 2: Retry button is always present
          const retryButton = screen.getByTestId('error-boundary-retry');
          expect(retryButton).toBeDefined();
          expect(retryButton.textContent).toBe('Retry');

          // PROPERTY 3: Accessibility attributes are always correct
          expect(errorUI.getAttribute('role')).toBe('alert');
          expect(errorUI.getAttribute('aria-live')).toBe('assertive');

          // PROPERTY 4: Shell chrome (sidebar + header) is NEVER unmounted
          expect(screen.getByTestId('sidebar-nav')).toBeDefined();
          expect(screen.getByTestId('sidebar-nav').textContent).toBe('Sidebar');
          expect(screen.getByTestId('shell-header')).toBeDefined();
          expect(screen.getByTestId('shell-header').textContent).toBe('Header');
          expect(screen.getByTestId('shell-container')).toBeDefined();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('for any error, clicking Retry resets the boundary and re-renders children', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 200 }), (errorMessage) => {
        cleanup();

        let shouldThrow = true;

        function ConditionalPage(): React.ReactElement {
          if (shouldThrow) {
            throw new Error(errorMessage);
          }
          return <div data-testid="page-content">Recovered</div>;
        }

        render(
          <PageErrorBoundary>
            <ConditionalPage />
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

        // PROPERTY: After retry with resolved error, content renders
        expect(screen.getByTestId('page-content')).toBeDefined();
        expect(screen.getByTestId('page-content').textContent).toBe('Recovered');
        expect(screen.queryByTestId('page-error-boundary')).toBeNull();
      }),
      { numRuns: 30 },
    );
  });

  it('error boundary isolates failures — multiple boundaries are independent', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 100 }),
        fc.string({ minLength: 1, maxLength: 100 }),
        (error1, error2) => {
          cleanup();

          function ThrowingA(): React.ReactElement {
            throw new Error(error1);
          }

          function HealthyB(): React.ReactElement {
            return <div data-testid="healthy-section">Working fine</div>;
          }

          // Simulate two sections, each with their own error boundary
          render(
            <div>
              <PageErrorBoundary>
                <ThrowingA />
              </PageErrorBoundary>
              <PageErrorBoundary>
                <HealthyB />
              </PageErrorBoundary>
            </div>,
          );

          // PROPERTY: First boundary catches the error
          const errorBoundaries = screen.getAllByTestId('page-error-boundary');
          expect(errorBoundaries.length).toBe(1);

          // PROPERTY: Second boundary's content renders normally
          expect(screen.getByTestId('healthy-section')).toBeDefined();
          expect(screen.getByTestId('healthy-section').textContent).toBe('Working fine');
        },
      ),
      { numRuns: 30 },
    );
  });
});
