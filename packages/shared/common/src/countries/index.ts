export type {
  CountryFeatureFlags,
  CountryImplementationStatus,
  CountryProfile,
  CountryTenantConfig,
} from './types.js';

export {
  academicYearWindow,
  countryBoardDefinitions,
  countryDefaultGrades,
} from './academic.js';
export type {
  AcademicYearWindow,
  CountryBoardDefinition,
  CountryBoardType,
  CountryGradeDefinition,
} from './academic.js';

export {
  DEFAULT_COUNTRY_CODE,
  defaultTenantConfig,
  getCountry,
  isCountryImplemented,
  listCountries,
  listImplementedCountries,
  normalizeCountryCode,
  requireCountry,
  tenantConfigFromCountry,
} from './catalog.js';
