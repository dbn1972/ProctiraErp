const CODE_TO_KEY = {
  required: 'common.required',
  invalid_date: 'registration.invalidDateOfBirth',
  invalid_email: 'registration.invalidEmail',
  invalid_phone: 'registration.invalidPhone',
  VALIDATION_ERROR: 'errors.validation',
  FORM_CONFIGURATION_NOT_FOUND: 'registration.configMissingMessage',
  PUBLIC_REGISTRATION_CONTEXT_NOT_FOUND: 'errors.contextMissing',
  PUBLIC_REGISTRATION_CONTEXT_UNAVAILABLE: 'errors.unavailable',
  TENANT_REQUIRED: 'errors.unavailable',
} as const;

type KnownCode = keyof typeof CODE_TO_KEY;

function isKnownCode(value: string): value is KnownCode {
  return Object.prototype.hasOwnProperty.call(CODE_TO_KEY, value);
}

/**
 * Turn an API or client error token into catalog copy.
 * Human sentences from the service (they contain a space) are kept.
 * Machine codes are never shown raw.
 */
export function registrationErrorMessage(
  t: (key: string) => string,
  input: { code?: string; rule?: string; message?: string } | string | undefined,
): string {
  const token =
    typeof input === 'string'
      ? { message: input }
      : {
          code: input?.code,
          rule: input?.rule,
          message: input?.message,
        };
  const code = (token.code || token.rule || '').trim();
  if (code && isKnownCode(code)) return t(CODE_TO_KEY[code]);

  const message = (token.message ?? '').trim();
  if (message && isKnownCode(message)) return t(CODE_TO_KEY[message]);
  if (message && /\s/.test(message)) return message;
  return t('errors.unknown');
}
