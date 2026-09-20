/** Server-side fail-closed loaders for the public registration wizard. */
import {
  getFormConfiguration,
  RegistrationApiError,
  type FormConfiguration,
} from './api';
import { isValidInstitutionId } from './validation';

export type FormConfigurationLoadResult =
  | { status: 'ready'; configuration: FormConfiguration }
  | { status: 'selection_required' }
  | { status: 'not_found' }
  | { status: 'unavailable' };

/**
 * Load a published form only by concrete institution UUID. Missing config and
 * service outage are deliberately distinct and neither becomes an empty form.
 */
export async function loadFormConfiguration(
  institutionId: string | undefined,
): Promise<FormConfigurationLoadResult> {
  if (!institutionId || !isValidInstitutionId(institutionId)) {
    return { status: 'selection_required' };
  }

  try {
    const configuration = await getFormConfiguration(institutionId);
    if (configuration.institutionId !== institutionId || configuration.version < 1) {
      return { status: 'unavailable' };
    }
    return { status: 'ready', configuration };
  } catch (error) {
    if (error instanceof RegistrationApiError && error.statusCode === 404) {
      return { status: 'not_found' };
    }
    return { status: 'unavailable' };
  }
}
