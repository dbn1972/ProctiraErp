/**
 * AttendanceCalendar — per-student attendance calendar view.
 *
 * Migrated from `School Platform Design/src/app/components/AttendanceCalendar.tsx`
 * per task 60.2. Real data wiring is task 60.3.
 */
import { useParams } from 'react-router-dom';

export default function AttendanceCalendar() {
  const { studentId } = useParams<{ studentId: string }>();
  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold">Attendance Calendar — Student {studentId}</h1>
      <p className="text-muted-foreground mt-2">
        Day-by-day attendance calendar for the selected student. Placeholder pending task 60.3.
      </p>
    </div>
  );
}
