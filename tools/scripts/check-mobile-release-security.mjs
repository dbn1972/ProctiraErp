#!/usr/bin/env node
/**
 * PRC-M470 — mobile release-security static gate (fail closed).
 *
 * Asserts, without building an APK, that the Flutter mobile app does not ship
 * an insecure release posture:
 *   1. android release build type must NOT unconditionally sign with debug keys
 *      (it must load a real keystore and fail closed otherwise).
 *   2. the Dart injector must enforce HTTPS for the API base URL in release
 *      builds (no cleartext localhost default reaching production).
 *
 * Exit 0 on pass; exit 1 on violation. No external deps.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const mobile = join(repoRoot, 'apps', 'mobile');

const failures = [];

function read(rel) {
  try {
    return readFileSync(join(mobile, rel), 'utf8');
  } catch (err) {
    failures.push(`cannot read ${rel}: ${err.message}`);
    return '';
  }
}

// 1. Release signing must not be an unconditional debug signing config.
const gradle = read('android/app/build.gradle.kts');
const unconditionalDebug =
  /release\s*\{[^}]*signingConfig\s*=\s*signingConfigs\.getByName\("debug"\)\s*}/s;
if (unconditionalDebug.test(gradle)) {
  failures.push('android release build type signs with debug keys unconditionally (PRC-M470)');
}
if (!/throw[^\n]*GradleException/.test(gradle)) {
  failures.push(
    'android release build type must fail closed when no release keystore is configured (PRC-M470)',
  );
}

// 2. Injector must enforce HTTPS in release builds.
const injector = read('lib/core/di/injector.dart');
if (!/assertSecureApiBaseUrl/.test(injector)) {
  failures.push('injector.dart is missing the assertSecureApiBaseUrl guard (PRC-M470)');
}
if (!/isRelease\s*&&\s*scheme\s*!==?\s*'https'|isRelease && scheme != 'https'/.test(injector)) {
  failures.push(
    'injector.dart does not reject cleartext API_BASE_URL in release builds (PRC-M470)',
  );
}

if (failures.length > 0) {
  console.error('check-mobile-release-security: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('check-mobile-release-security: PASS');
