/**
 * Server-side helpers for the Registration Portal.
 *
 * These wrap the API client with safe fallbacks so that Server Components can
 * render even if the backend Registration Service is temporarily unreachable
 * during build/runtime.
 */
import { getFormConfiguration, type FormConfiguration } from './api';

/**
 * Loads the form configuration for an institution type.
 *
 * The backend's `/registrations/form-config/:institutionId` route resolves
 * configuration by **institution UUID**. For the public flow we accept a
 * symbolic institution-type slug (e.g. "primary"), and the backend returns an
 * empty configuration when the slug doesn't resolve to anything — that's the
 * signal to render the default field set.
 */
export async function loadFormConfiguration(
  institutionTypeOrId: string,
): Promise<FormConfiguration> {
  try {
    return await getFormConfiguration(institutionTypeOrId);
  } catch {
    // Backend unreachable or 404 — fall back to an empty config.
    return { institutionTypeId: institutionTypeOrId, fields: [] };
  }
}
