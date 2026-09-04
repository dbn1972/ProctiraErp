/**
 * Multi-country school-ERP catalog.
 *
 * The platform is designed for many education systems. India (`IN`) is the
 * first implemented country; other catalog entries are reserved so later
 * phases can add rules without inventing a new country model.
 */

export type CountryImplementationStatus = 'implemented' | 'planned';

export type CountryFeatureFlags = {
  attendance: boolean;
  assessments: boolean;
  examinations: boolean;
  scholarships: boolean;
  transport: boolean;
  /** India Unified District Information System for Education — later phase */
  udise: boolean;
};

export type CountryProfile = {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  status: CountryImplementationStatus;
  currency: string;
  timezone: string;
  phoneCountryCode: string;
  defaultLocale: string;
  locales: readonly string[];
  dateFormat: string;
  /** 1–12, month the academic year typically starts */
  academicYearStartMonth: number;
  nationalIdLabel: string;
  boards: readonly string[];
  areaLevels: readonly string[];
  features: CountryFeatureFlags;
};

export type CountryTenantConfig = {
  countryCode: string;
  locale: string;
  locales: string[];
  timezone: string;
  currency: string;
  dateFormat: string;
  academicYearStart: number;
  nationalIdLabel: string;
  features: CountryFeatureFlags;
};
