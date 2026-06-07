/**
 * StudentBulkImport — Page component for the student bulk import wizard.
 *
 * Lazy-loaded by StudentsRouter at `/app/students/import`.
 * Renders the multi-step ImportWizard component.
 *
 * _Requirements: 6.7, 6.8, 19.2, 19.5_
 */
'use client';

import { ImportWizard } from './import/ImportWizard';

export default function StudentBulkImport() {
  return <ImportWizard />;
}
