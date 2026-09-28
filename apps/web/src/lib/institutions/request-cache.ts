import 'server-only';
import { cache } from 'react';

import { getInstitution, getInstitutionOverview } from './api';

/**
 * One institution read per RSC request. The detail layout and the tab page
 * both need the record; React's server cache collapses those into one gateway
 * call. React 18's client entry (used by Vitest) does not export `cache`, so
 * this module stays on the server-only graph.
 */
export const getCachedInstitution = cache(getInstitution);
export const getCachedInstitutionOverview = cache(getInstitutionOverview);
