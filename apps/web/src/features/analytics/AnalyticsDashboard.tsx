/**
 * AnalyticsDashboard — proof-of-concept showcase for the token-driven
 * Recharts wrappers introduced in Task 47.3.
 *
 * The component renders two charts (a bar chart for enrollment-by-stage and
 * a line chart for assessment trends) using the canonical wrappers exported
 * from `@proctira/ui/components`:
 *
 *   - `<ThemedXAxis>` / `<ThemedYAxis>` paint stroke + tick colors from the
 *     `--border` and `--muted-foreground` tokens.
 *   - `<ThemedCartesianGrid>` paints gridlines from `--border`.
 *   - `<ThemedTooltip>` paints the floating card surface from `--background`,
 *     `--border`, and `--foreground`.
 *   - `useSeriesColor(index)` returns the per-series fill color from
 *     `--chart-1` … `--chart-5`, cycling for indices ≥ 5.
 *
 * All five tokens live in `packages/ui/styles/theme.css`. Toggling
 * `<ThemeProvider>` between Light / Dark / System repaints the entire chart
 * — axes, gridlines, tooltip, and series — without re-rendering the chart
 * data, because the wrappers subscribe to `<html>` mutations under the hood.
 *
 * Sample data is hard-coded so the screen renders before the analytics
 * service is wired up; replace with `useSWR()` / server-component data
 * once the Requirement-43 analytics endpoints land.
 */

'use client';

import { BarChart, Bar, LineChart, Line, ResponsiveContainer } from 'recharts';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ThemedCartesianGrid,
  ThemedTooltip,
  ThemedXAxis,
  ThemedYAxis,
  useSeriesColor,
} from '@proctira/ui/components';

// Demo-only fixture data. In production this comes from the analytics API.
const enrollmentByStage = [
  { stage: 'Pre-Primary', students: 1240 },
  { stage: 'Primary', students: 4380 },
  { stage: 'Secondary', students: 3120 },
  { stage: 'Tertiary', students: 980 },
];

const assessmentTrend = [
  { term: 'T1', literacy: 62, numeracy: 58 },
  { term: 'T2', literacy: 67, numeracy: 61 },
  { term: 'T3', literacy: 71, numeracy: 65 },
  { term: 'T4', literacy: 74, numeracy: 70 },
];

export default function AnalyticsDashboard() {
  // Pull the first two series colors. The hook re-runs whenever the active
  // theme changes, so `<Bar fill={...}>` props always carry the correct
  // light or dark token.
  const enrollmentColor = useSeriesColor(0);
  const literacyColor = useSeriesColor(1);
  const numeracyColor = useSeriesColor(2);

  return (
    <div className="grid gap-6 p-6 md:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Enrollment by stage</CardTitle>
          <CardDescription>
            Active enrolments across pre-primary through tertiary education.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={enrollmentByStage}>
              <ThemedCartesianGrid />
              <ThemedXAxis dataKey="stage" />
              <ThemedYAxis />
              <ThemedTooltip />
              <Bar dataKey="students" fill={enrollmentColor} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Assessment trend</CardTitle>
          <CardDescription>
            Average literacy and numeracy scores per term.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={assessmentTrend}>
              <ThemedCartesianGrid />
              <ThemedXAxis dataKey="term" />
              <ThemedYAxis domain={[0, 100]} />
              <ThemedTooltip />
              <Line
                type="monotone"
                dataKey="literacy"
                stroke={literacyColor}
                strokeWidth={2}
                dot={{ fill: literacyColor }}
              />
              <Line
                type="monotone"
                dataKey="numeracy"
                stroke={numeracyColor}
                strokeWidth={2}
                dot={{ fill: numeracyColor }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
