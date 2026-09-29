/**
 * Shared dirty signal + leave-confirm for institution profile forms.
 *
 * Dirty state survives RSC/client remounts via a window bag + sessionStorage.
 * Leave confirmation uses an in-app dialog (not window.confirm) so Playwright
 * and browsers behave the same in production CI.
 */
export const WINDOW_DIRTY_BAG = '__proctiraInstitutionFormDirty';
const STORAGE_KEY = 'proctira.institutionFormDirty';
export const LEAVE_CONFIRM_EVENT = 'proctira:institution-leave-confirm';

type DirtyBag = Record<string, boolean>;
type LeaveResolver = (ok: boolean) => void;

let leaveResolver: LeaveResolver | null = null;

function readBag(): DirtyBag {
  if (typeof window === 'undefined') return {};
  const root = window as unknown as Record<string, DirtyBag | undefined>;
  const fromWindow = root[WINDOW_DIRTY_BAG] ?? {};
  if (Object.keys(fromWindow).length > 0) return fromWindow;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DirtyBag;
    root[WINDOW_DIRTY_BAG] = parsed;
    return parsed;
  } catch {
    return {};
  }
}

function persistBag(bag: DirtyBag): void {
  if (typeof window === 'undefined') return;
  const root = window as unknown as Record<string, DirtyBag | undefined>;
  root[WINDOW_DIRTY_BAG] = bag;
  try {
    if (Object.keys(bag).length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(bag));
  } catch {
    // Private mode / quota — window bag alone still works for the SPA session.
  }
  if (Object.values(bag).some(Boolean)) {
    document.documentElement.dataset.institutionFormDirty = 'true';
  } else {
    delete document.documentElement.dataset.institutionFormDirty;
  }
}

export function readWindowDirty(formKey: string): boolean {
  return Boolean(readBag()[formKey]);
}

export function writeWindowDirty(formKey: string, dirty: boolean): void {
  if (typeof window === 'undefined') return;
  const bag = { ...readBag() };
  if (dirty) bag[formKey] = true;
  else delete bag[formKey];
  persistBag(bag);
}

/** Drop every dirty signal (window bag, sessionStorage, document dataset). */
export function clearAllInstitutionFormDirty(): void {
  if (typeof window === 'undefined') return;
  persistBag({});
  document
    .querySelectorAll('[data-testid="institution-profile-form"][data-dirty="true"]')
    .forEach((el) => el.setAttribute('data-dirty', 'false'));
}

/** True when any profile form stamped the bag or still has data-dirty="true". */
export function anyInstitutionFormDirty(): boolean {
  if (typeof window === 'undefined') return false;
  if (document.documentElement.dataset.institutionFormDirty === 'true') return true;
  const bag = readBag();
  if (Object.values(bag).some(Boolean)) return true;
  return Boolean(
    document.querySelector('[data-testid="institution-profile-form"][data-dirty="true"]'),
  );
}

/**
 * Ask the user before leaving a dirty form. Resolves true when navigation may
 * proceed. Uses the in-app dialog host (InstitutionLeaveConfirmHost).
 */
export function requestLeaveConfirm(): Promise<boolean> {
  if (!anyInstitutionFormDirty()) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(true);
  // Replace any in-flight prompt (e.g. double-click) with a stay decision.
  if (leaveResolver) {
    leaveResolver(false);
    leaveResolver = null;
  }
  return new Promise<boolean>((resolve) => {
    leaveResolver = resolve;
    window.dispatchEvent(new CustomEvent(LEAVE_CONFIRM_EVENT));
  });
}

/** Called by the dialog host when the user chooses Stay or Leave. */
export function resolveLeaveConfirm(ok: boolean): void {
  const resolver = leaveResolver;
  leaveResolver = null;
  resolver?.(ok);
}
