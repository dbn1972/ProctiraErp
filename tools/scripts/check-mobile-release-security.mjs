#!/usr/bin/env node
/**
 * PRC-M470 — mobile release-security static gate (fail closed).
 *
 * Asserts, without building an APK, that the Flutter mobile app does not ship
 * an insecure release posture:
 *   1. android release build type must NOT unconditionally sign with debug keys
 *      (it must load a real keystore and fail closed otherwise).
 *   2. the fail-closed throw must be scoped to release tasks only, NOT run in
 *      the configuration phase inside `buildTypes.release {}` (that breaks
 *      debug builds / `flutter run`).
 *   3. the Dart injector must enforce HTTPS for the API base URL in release
 *      builds (no cleartext localhost default reaching production).
 *
 * Exit 0 on pass; exit 1 on violation. No external deps.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Extract the brace-balanced body of the first `release { ... }` block that
 * follows `buildTypes`. Returns '' when no such block exists.
 */
function releaseBuildTypeBlock(gradle) {
  const buildTypesIdx = gradle.indexOf('buildTypes');
  if (buildTypesIdx === -1) return '';
  const releaseStart = gradle.indexOf('release', buildTypesIdx);
  const braceOpen = gradle.indexOf('{', releaseStart);
  if (releaseStart === -1 || braceOpen === -1) return '';
  let depth = 0;
  for (let i = braceOpen; i < gradle.length; i++) {
    const ch = gradle[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return gradle.slice(braceOpen, i + 1);
    }
  }
  return gradle.slice(braceOpen);
}

/**
 * Pure checker for the Android release-signing posture. Returns a list of
 * violation strings (empty = secure).
 */
export function releaseSigningViolations(gradle) {
  const failures = [];

  // 1. Release signing must not be an UNCONDITIONAL debug signing config.
  //    A debug fallback guarded by `else if (ALLOW_DEBUG_SIGNED_RELEASE)` is
  //    an explicit local opt-in and is allowed; a bare assignment is not.
  const unconditionalDebug =
    /release\s*\{[^}]*?(?<!else\s)(?<!else if \([^)]*\)\s)signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)/s;
  if (unconditionalDebug.test(gradle)) {
    failures.push('android release build type signs with debug keys unconditionally (PRC-M470)');
  }

  // 2. The release-signing contract must fail closed — a GradleException must
  //    be thrown somewhere when no keystore (and no explicit opt-in) exists.
  if (!/throw[^\n]*GradleException/.test(gradle)) {
    failures.push(
      'android release build type must fail closed when no release keystore is configured (PRC-M470)',
    );
  }

  // 3. The fail-closed throw must NOT be in the configuration phase inside
  //    `buildTypes.release {}`. AGP configures every build type while building
  //    any variant, so a throw there also aborts `assembleDebug` / `flutter
  //    run`. It must be deferred to release-scoped tasks.
  if (/throw[^\n]*GradleException/.test(releaseBuildTypeBlock(gradle))) {
    failures.push(
      'android fail-closed throw is inside buildTypes.release {} (configuration phase); ' +
        'it breaks debug builds. Defer it to a doFirst on *Release tasks (PRC-M470)',
    );
  }

  // 4. The deferred throw must be scoped to release tasks only.
  const releaseTaskScoped =
    /tasks\.matching\s*\{[^}]*Release[^}]*\}[\s\S]*?doFirst\s*\{[\s\S]*?throw[^\n]*GradleException/;
  if (!releaseTaskScoped.test(gradle)) {
    failures.push(
      'android fail-closed signing check must be scoped to release tasks via ' +
        'tasks.matching { ...Release }.configureEach { doFirst { throw ... } } (PRC-M470)',
    );
  }

  return failures;
}

/**
 * Pure checker for the Dart injector HTTPS-in-release posture.
 */
export function injectorViolations(injector) {
  const failures = [];
  if (!/assertSecureApiBaseUrl/.test(injector)) {
    failures.push('injector.dart is missing the assertSecureApiBaseUrl guard (PRC-M470)');
  }
  if (!/isRelease\s*&&\s*scheme\s*!==?\s*'https'|isRelease && scheme != 'https'/.test(injector)) {
    failures.push(
      'injector.dart does not reject cleartext API_BASE_URL in release builds (PRC-M470)',
    );
  }
  return failures;
}

/**
 * Evaluate the mobile app at `mobileDir`. Returns all violation strings.
 */
export function evaluate(mobileDir) {
  const failures = [];
  const read = (rel) => {
    try {
      return readFileSync(join(mobileDir, rel), 'utf8');
    } catch (err) {
      failures.push(`cannot read ${rel}: ${err.message}`);
      return '';
    }
  };
  const gradle = read('android/app/build.gradle.kts');
  const injector = read('lib/core/di/injector.dart');
  failures.push(...releaseSigningViolations(gradle));
  failures.push(...injectorViolations(injector));
  return failures;
}

function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..', '..');
  const mobile = join(repoRoot, 'apps', 'mobile');
  const failures = evaluate(mobile);
  if (failures.length > 0) {
    console.error('check-mobile-release-security: FAIL');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('check-mobile-release-security: PASS');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
