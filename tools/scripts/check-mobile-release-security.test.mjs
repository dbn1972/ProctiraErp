/**
 * PRC-M470 — tests for the mobile release-security static gate.
 *
 * The gate must fail closed ONLY when the release signing posture is actually
 * insecure, and must NOT fire for the correct shape (deferred, release-scoped
 * fail-closed throw with a conditional debug opt-in). It must also catch the
 * review regression where the throw lived in `buildTypes.release {}` and so
 * broke debug builds too.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { injectorViolations, releaseSigningViolations } from './check-mobile-release-security.mjs';

// The current, correct gradle shape: conditional debug opt-in in the build
// type, fail-closed throw deferred to a doFirst on *Release tasks.
const GOOD_GRADLE = `
android {
    signingConfigs {
        create("release") {
            val keystoreFile = rootProject.file("key.properties")
            if (keystoreFile.exists()) { /* load */ }
        }
    }
    buildTypes {
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            } else if (System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1") {
                signingConfig = signingConfigs.getByName("debug")
            }
        }
    }
    tasks.matching { task ->
        val name = task.name
        name.startsWith("assemble") && name.contains("Release")
    }.configureEach {
        doFirst {
            val releaseSigning = signingConfigs.getByName("release")
            val allowDebugSigned = System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1"
            if (releaseSigning.storeFile == null && !allowDebugSigned) {
                throw org.gradle.api.GradleException("Release build has no signing config.")
            }
        }
    }
}
`;

// The regressed shape from PR #593 review blocker 2: the throw runs during
// configuration inside buildTypes.release {}, breaking debug builds too.
const CONFIG_PHASE_THROW_GRADLE = `
android {
    buildTypes {
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            } else if (System.getenv("ALLOW_DEBUG_SIGNED_RELEASE") == "1") {
                signingConfig = signingConfigs.getByName("debug")
            } else {
                throw org.gradle.api.GradleException("Release build has no signing config.")
            }
        }
    }
}
`;

// Insecure: unconditionally signs release with the debug key.
const UNCONDITIONAL_DEBUG_GRADLE = `
android {
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}
`;

// No fail-closed throw at all.
const NO_THROW_GRADLE = `
android {
    buildTypes {
        release {
            val releaseSigning = signingConfigs.getByName("release")
            if (releaseSigning.storeFile != null) {
                signingConfig = releaseSigning
            }
        }
    }
}
`;

test('correct deferred/release-scoped shape passes', () => {
  assert.deepEqual(releaseSigningViolations(GOOD_GRADLE), []);
});

test('throw inside buildTypes.release {} (configuration phase) is rejected', () => {
  const v = releaseSigningViolations(CONFIG_PHASE_THROW_GRADLE);
  assert.ok(
    v.some((f) => f.includes('configuration phase')),
    `expected a configuration-phase violation, got: ${JSON.stringify(v)}`,
  );
});

test('unconditional debug signing is rejected', () => {
  const v = releaseSigningViolations(UNCONDITIONAL_DEBUG_GRADLE);
  assert.ok(
    v.some((f) => f.includes('debug keys unconditionally')),
    `expected an unconditional-debug violation, got: ${JSON.stringify(v)}`,
  );
});

test('missing fail-closed throw is rejected', () => {
  const v = releaseSigningViolations(NO_THROW_GRADLE);
  assert.ok(
    v.some((f) => f.includes('fail closed')),
    `expected a fail-closed violation, got: ${JSON.stringify(v)}`,
  );
});

test('injector enforcing HTTPS in release passes', () => {
  const injector = `
    void assertSecureApiBaseUrl(String url, {required bool isRelease}) {
      final scheme = Uri.parse(url).scheme;
      if (isRelease && scheme != 'https') {
        throw StateError('cleartext API base URL in release');
      }
    }
  `;
  assert.deepEqual(injectorViolations(injector), []);
});

test('injector without HTTPS enforcement is rejected', () => {
  const v = injectorViolations('void main() {}');
  assert.equal(v.length, 2);
});
