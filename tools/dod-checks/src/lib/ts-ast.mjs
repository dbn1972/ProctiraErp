/**
 * Lazy ts-morph loader. ts-morph is heavy and we want each individual check
 * to start fast, so we cache a single Project per process and lazy-load the
 * module so checks that don't need AST analysis stay regex-only.
 *
 * If ts-morph is not installed (e.g. in a minimal CI bootstrap stage), the
 * loader returns `null` and callers must fall back to text-based analysis.
 */
let projectPromise = null;

/**
 * Return a memoized ts-morph `Project` configured for the monorepo, or `null`
 * if ts-morph is not installed. Callers should treat `null` as "AST analysis
 * unavailable, fall back to text scanning".
 */
export async function getProject() {
  if (projectPromise) return projectPromise;
  projectPromise = (async () => {
    try {
      const mod = await import('ts-morph');
      const { Project, ScriptTarget, ModuleKind, ModuleResolutionKind } = mod;
      const project = new Project({
        useInMemoryFileSystem: false,
        skipFileDependencyResolution: true,
        compilerOptions: {
          target: ScriptTarget.ES2022,
          module: ModuleKind.ESNext,
          moduleResolution: ModuleResolutionKind.Bundler,
          allowJs: false,
          strict: false,
          skipLibCheck: true,
          noEmit: true,
        },
      });
      return { project, mod };
    } catch (err) {
      if (process.env.DOD_DEBUG) {
        console.warn('[dod-checks] ts-morph unavailable, falling back to regex:', err.message);
      }
      return null;
    }
  })();
  return projectPromise;
}

/**
 * Add a single source file to the shared Project and return the SourceFile,
 * or `null` if ts-morph is unavailable.
 */
export async function loadSourceFile(absPath) {
  const ctx = await getProject();
  if (!ctx) return null;
  // addSourceFileAtPathIfExists is forgiving — returns undefined on missing files.
  return ctx.project.addSourceFileAtPathIfExists(absPath) ?? null;
}

/**
 * Convenience: load multiple files; skip any that fail.
 */
export async function loadSourceFiles(absPaths) {
  const ctx = await getProject();
  if (!ctx) return null;
  /** @type {Array<unknown>} */
  const out = [];
  for (const p of absPaths) {
    const sf = ctx.project.addSourceFileAtPathIfExists(p);
    if (sf) out.push(sf);
  }
  return out;
}
