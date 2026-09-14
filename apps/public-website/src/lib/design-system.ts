/**
 * W2-DS-01 — prove this app consumes `@proctira/ui-components` (packages/ui).
 *
 * Apps historically forked local shadcn buttons. This module is the shared
 * design-system entry point; product surfaces should import from here (or
 * directly from `@proctira/ui-components`) instead of maintaining forks.
 */
export { Button, buttonVariants, type ButtonProps } from '@proctira/ui-components';
