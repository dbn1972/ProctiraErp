/**
 * Marketing home — re-exports the Task 50.2 LandingPage so the federated
 * SPA source and the App Router route share one implementation.
 * Chrome comes from `app/(marketing)/layout.tsx`; nested MarketingLayout
 * inside LandingPage only binds the document title.
 */
export { default } from '@/features/marketing/LandingPage';
