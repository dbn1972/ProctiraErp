import { RouteLoadingPanel } from '@/components/route-state/route-loading';

/**
 * Instant segment boundary for `/assessments/report-cards`.
 *
 * The page awaits gradebook section fan-out before it can render. Without a
 * `loading` file, the App Router does not commit the URL until that server
 * render finishes, so a click on the assessments hub can sit on `/assessments`
 * for the whole assertion window. This boundary commits the route immediately
 * and shows the shared skeleton until the page resolves.
 */
export default function ReportCardsLoading() {
  return <RouteLoadingPanel label="Loading report cards" />;
}
