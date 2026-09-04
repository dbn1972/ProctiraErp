import { requireCountry } from './catalog.js';
import type { CountryProfile } from './types.js';

export type CountryBoardType = 'NATIONAL' | 'STATE' | 'PRIVATE';

export type CountryBoardDefinition = {
  code: string;
  name: string;
  type: CountryBoardType;
};

export type CountryGradeDefinition = {
  name: string;
  code: string;
  order: number;
};

export type AcademicYearWindow = {
  startYear: number;
  endYear: number;
  startDate: string;
  endDate: string;
  code: string;
  name: string;
};

const INDIA_BOARD_DETAILS: Record<string, CountryBoardDefinition> = {
  CBSE: {
    code: 'CBSE',
    name: 'Central Board of Secondary Education',
    type: 'NATIONAL',
  },
  ICSE: {
    code: 'ICSE',
    name: 'Council for the Indian School Certificate Examinations',
    type: 'PRIVATE',
  },
  STATE: {
    code: 'STATE',
    name: 'State Education Board',
    type: 'STATE',
  },
};

/**
 * Resolve catalog board codes into seedable board records.
 * Unknown codes stay as STATE boards so later countries can add names later.
 */
export function countryBoardDefinitions(
  country: CountryProfile | string,
): CountryBoardDefinition[] {
  const profile = typeof country === 'string' ? requireCountry(country) : country;
  return profile.boards.map((code) => {
    const known = INDIA_BOARD_DETAILS[code];
    if (known) return known;
    return { code, name: `${profile.name} ${code} Board`, type: 'STATE' };
  });
}

/** India uses Class 1–12; other catalog countries get generic Grade 1–12. */
export function countryDefaultGrades(
  country: CountryProfile | string,
): CountryGradeDefinition[] {
  const profile = typeof country === 'string' ? requireCountry(country) : country;
  const label = profile.code === 'IN' ? 'Class' : 'Grade';
  return Array.from({ length: 12 }, (_, index) => {
    const order = index + 1;
    return {
      name: `${label} ${order}`,
      code: String(order),
      order,
    };
  });
}

export function academicYearWindow(
  startMonth: number,
  now: Date = new Date(),
): AcademicYearWindow {
  const month = now.getUTCMonth() + 1;
  const calendarYear = now.getUTCFullYear();
  const startYear = month >= startMonth ? calendarYear : calendarYear - 1;
  const endYear = startMonth === 1 ? startYear : startYear + 1;
  const startDate = `${startYear}-${pad2(startMonth)}-01`;
  const endDate = lastDayOfPreviousMonth(endYear, startMonth);
  const endShort = String(endYear).slice(-2);
  return {
    startYear,
    endYear,
    startDate,
    endDate,
    code: `AY-${startYear}-${endShort}`,
    name: `Academic Year ${startYear}-${endShort}`,
  };
}

function lastDayOfPreviousMonth(endYear: number, startMonth: number): string {
  const end = new Date(Date.UTC(endYear, startMonth - 1, 0));
  return `${end.getUTCFullYear()}-${pad2(end.getUTCMonth() + 1)}-${pad2(end.getUTCDate())}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
