/** Server-side fail-closed loaders for the public registration wizard. */
import {
  getFormConfiguration,
  getInstitutions,
  RegistrationApiError,
  type FormConfiguration,
} from './api';
import { MAX_PUBLIC_PAGE_SIZE } from './pagination';
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

/**
 * School display name for an institution id, when the public directory returns it.
 * A miss stays null so the apply flow does not invent a name or show only a UUID.
 */
export async function lookupInstitutionName(institutionId: string): Promise<string | null> {
  if (!isValidInstitutionId(institutionId)) return null;
  try {
    let page = 1;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await getInstitutions({ page, pageSize: MAX_PUBLIC_PAGE_SIZE });
      const match = response.data.find((row) => row.id === institutionId);
      const name = match?.name?.trim();
      if (name) return name;
      if (page >= response.meta.totalPages || response.data.length === 0) return null;
      page += 1;
    }
    return null;
  } catch {
    return null;
  }
}
