/**
 * PRC-M569: the student import UI only calls paths the backend registers, and
 * the federated /app/students/import route hands off to the App Router page.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudentsRouter from './StudentsRouter';
const repo = join(__dirname, '../../../../..');
function registeredImportRoutes(): Set<string> {
  const src = readFileSync(
    join(repo, 'packages/backend/student/src/import/import-routes.ts'),
    'utf8',
  );
  const routes = new Set<string>();
  for (const m of src.matchAll(/scope\.(get|post)\(\s*`\$\{prefix\}([^`]*)`/g)) {
    routes.add(`${m[1]!.toUpperCase()} /students${m[2]}`);
  }
  return routes;
}
function clientImportPaths(): string[] {
  const src = readFileSync(join(repo, 'apps/web/src/lib/api/students.ts'), 'utf8');
  const paths: string[] = [];
  for (const m of src.matchAll(/['`](\/students\/import[^'`]*)['`]/g)) {
    paths.push(m[1]!.replace(/\$\{[^}]+\}/g, ':jobId'));
  }
  return paths;
}
afterEach(() => vi.restoreAllMocks());
describe('student import contract (PRC-M569)', () => {
  it('every /students/import path used by the web client is a registered backend route', () => {
    const routes = [...registeredImportRoutes()].map((r) => r.split(' ')[1]);
    const used = clientImportPaths();
    expect(used.length).toBeGreaterThan(0);
    for (const path of used) expect(routes).toContain(path);
  });
  it('/app/students/import redirects to the App Router bulk import page', () => {
    const replace = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      replace,
    } as Location);
    render(
      <MemoryRouter initialEntries={['/import']}>
        <StudentsRouter />
      </MemoryRouter>,
    );
    return vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/students/import'));
  });
});
