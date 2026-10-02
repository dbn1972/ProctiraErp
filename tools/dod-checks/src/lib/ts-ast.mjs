/**
 * Lazy ts-morph loader. ts-morph is heavy and we want each individual check
 * to start fast, so we cache a single Project per process and lazy-load the
 * module so checks that don't need AST analysis stay regex-only.
 *
 * If ts-morph is not installed (e.g. in a minimal CI bootstrap stage), the
 * loader returns `null` and callers must fall back to text-based analysis.
 *
 * PRC-L375: the regex fallback is blind to several envelope/i18n patterns, so
 * it is only allowed as an announced local degradation. With DOD_REQUIRE_AST=1,
 * or under CI=true unless DOD_REQUIRE_AST=0, a missing ts-morph throws and the
 * aggregator exits 2.
 */
let projectPromise = null;

/** True when AST analysis is mandatory for this run. */
export function isAstRequired(env = process.env) {
  if (env.DOD_REQUIRE_AST === '1') return true;
  if (env.DOD_REQUIRE_AST === '0') return false;
  return env.CI === 'true';
}

async function importTsMorph() {
  // Test hook: simulate a bootstrap environment without ts-morph installed.
  if (process.env.DOD_SIMULATE_MISSING_TS_MORPH === '1') {
    throw new Error("Cannot find package 'ts-morph' (simulated)");
  }
  return import('ts-morph');
}

/**
 * Return a memoized ts-morph `Project` configured for the monorepo, or `null`
 * if ts-morph is not installed. Callers should treat `null` as "AST analysis
 * unavailable, fall back to text scanning".
 */
export async function getProject() {
  if (projectPromise) return projectPromise;
  projectPromise = (async () => {
    try {
      const mod = await importTsMorph();
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
      if (isAstRequired()) {
        throw new Error(
          `[dod-checks] ts-morph is unavailable but AST analysis is required (CI/DOD_REQUIRE_AST): ${err.message}`,
        );
      }
      console.warn(
        '[dod-checks] WARNING: ts-morph unavailable, falling back to regex (reduced coverage):',
        err.message,
      );
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
