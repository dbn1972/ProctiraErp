/**
 * G-925 — flatten the facility hierarchy into a verification CSV
 * (one row per land / building / floor / room).
 */
import type { InfrastructureHierarchy } from './types';

function cell(value: string | number | null): string {
  const str = value === null ? '' : String(value);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

export function hierarchyToCsv(hierarchy: InfrastructureHierarchy): string {
  const rows: string[] = ['level,path,name,capacity,condition,description'];
  const push = (
    level: string,
    path: string[],
    node: { name: string; capacity: number; condition: string; description: string | null },
  ) => {
    rows.push(
      [level, path.join(' / '), node.name, node.capacity, node.condition, node.description]
        .map(cell)
        .join(','),
    );
  };
  for (const land of hierarchy.lands) {
    push('land', [], land);
    for (const building of land.buildings) {
      push('building', [land.name], building);
      for (const floor of building.floors) {
        push('floor', [land.name, building.name], floor);
        for (const room of floor.rooms) {
          push('room', [land.name, building.name, floor.name], room);
        }
      }
    }
  }
  return `${rows.join('\n')}\n`;
}
