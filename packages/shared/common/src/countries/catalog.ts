import type { CountryProfile, CountryTenantConfig } from './types.js';

/** First implemented market. New tenants default here. */
export const DEFAULT_COUNTRY_CODE = 'IN';

const INDIA: CountryProfile = {
  code: 'IN',
  name: 'India',
  status: 'implemented',
  currency: 'INR',
  timezone: 'Asia/Kolkata',
  phoneCountryCode: '+91',
  defaultLocale: 'en',
  locales: ['en', 'hi', 'ta', 'te', 'mr', 'bn', 'gu', 'kn'],
  dateFormat: 'DD/MM/YYYY',
  academicYearStartMonth: 4,
  nationalIdLabel: 'Aadhaar',
  boards: ['CBSE', 'ICSE', 'STATE'],
  areaLevels: ['country', 'state', 'district', 'block', 'village'],
  features: {
    attendance: true,
    assessments: true,
    examinations: true,
    scholarships: true,
    transport: false,
    udise: true,
  },
};

function planned(
  code: string,
  name: string,
  extras: Pick<CountryProfile, 'currency' | 'timezone' | 'phoneCountryCode' | 'defaultLocale'>,
): CountryProfile {
  return {
    code,
    name,
    status: 'planned',
    locales: [extras.defaultLocale],
    dateFormat: 'DD/MM/YYYY',
    academicYearStartMonth: 1,
    nationalIdLabel: 'National ID',
    boards: [],
    areaLevels: ['country', 'region', 'district'],
    features: {
      attendance: true,
      assessments: true,
      examinations: true,
      scholarships: false,
      transport: false,
      udise: false,
    },
    ...extras,
  };
}

const CATALOG: Record<string, CountryProfile> = {
  IN: INDIA,
  BD: planned('BD', 'Bangladesh', {
    currency: 'BDT',
    timezone: 'Asia/Dhaka',
    phoneCountryCode: '+880',
    defaultLocale: 'en',
  }),
  AE: planned('AE', 'United Arab Emirates', {
    currency: 'AED',
    timezone: 'Asia/Dubai',
    phoneCountryCode: '+971',
    defaultLocale: 'ar',
  }),
  KE: planned('KE', 'Kenya', {
    currency: 'KES',
    timezone: 'Africa/Nairobi',
    phoneCountryCode: '+254',
    defaultLocale: 'en',
  }),
  NG: planned('NG', 'Nigeria', {
    currency: 'NGN',
    timezone: 'Africa/Lagos',
    phoneCountryCode: '+234',
    defaultLocale: 'en',
  }),
  ZA: planned('ZA', 'South Africa', {
    currency: 'ZAR',
    timezone: 'Africa/Johannesburg',
    phoneCountryCode: '+27',
    defaultLocale: 'en',
  }),
  GB: planned('GB', 'United Kingdom', {
    currency: 'GBP',
    timezone: 'Europe/London',
    phoneCountryCode: '+44',
    defaultLocale: 'en',
  }),
};

export function normalizeCountryCode(code: string): string {
  return code.trim().toUpperCase();
}

export function getCountry(code: string): CountryProfile | undefined {
  return CATALOG[normalizeCountryCode(code)];
}

export function requireCountry(code: string): CountryProfile {
  const country = getCountry(code);
  if (!country) {
    throw new Error(`Unknown country code: ${code}`);
  }
  return country;
}

export function isCountryImplemented(code: string): boolean {
  return getCountry(code)?.status === 'implemented';
}

export function listCountries(): CountryProfile[] {
  return Object.values(CATALOG);
}

export function listImplementedCountries(): CountryProfile[] {
  return listCountries().filter((country) => country.status === 'implemented');
}

export function tenantConfigFromCountry(country: CountryProfile): CountryTenantConfig {
  return {
    countryCode: country.code,
    locale: country.defaultLocale,
    locales: [...country.locales],
    timezone: country.timezone,
    currency: country.currency,
    dateFormat: country.dateFormat,
    academicYearStart: country.academicYearStartMonth,
    nationalIdLabel: country.nationalIdLabel,
    features: { ...country.features },
  };
}

export function defaultTenantConfig(): CountryTenantConfig {
  return tenantConfigFromCountry(requireCountry(DEFAULT_COUNTRY_CODE));
}
