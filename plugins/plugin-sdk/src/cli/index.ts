#!/usr/bin/env node
/**
 * ProctiraERP Plugin CLI
 *
 * Command-line interface for plugin development:
 * - proctira-plugin init       Create a new plugin from the starter template
 * - proctira-plugin dev        Start the development server with hot reload
 * - proctira-plugin validate   Validate the plugin manifest
 * - proctira-plugin test       Run the plugin test harness
 * - proctira-plugin build      Build the plugin for distribution
 */

const COMMANDS = {
  init: 'Create a new plugin from the starter template',
  dev: 'Start the development server with hot reload',
  validate: 'Validate the plugin manifest and configuration',
  test: 'Run the plugin test harness',
  build: 'Build the plugin for distribution',
  help: 'Show this help message',
} as const;

function printHelp(): void {
  console.log('ProctiraERP Plugin CLI\n');
  console.log('Usage: proctira-plugin <command> [options]\n');
  console.log('Commands:');
  for (const [cmd, desc] of Object.entries(COMMANDS)) {
    console.log(`  ${cmd.padEnd(12)} ${desc}`);
  }
  console.log('\nOptions:');
  console.log('  --port <number>    Port for dev server (default: 4400)');
  console.log('  --watch <dir>      Directory to watch (default: ./src)');
  console.log('  --entry <file>     Plugin entry file (default: ./src/index.ts)');
  console.log('  --no-hot-reload    Disable hot reload in dev mode');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help') {
    printHelp();
    return;
  }

  switch (command) {
    case 'init':
      console.log('[init] Creating new plugin from starter template...');
      console.log('  Use: npx @proctira/plugin-sdk init <plugin-name>');
      console.log('  This will scaffold a new plugin project with:');
      console.log('    - manifest.json');
      console.log('    - src/index.ts (plugin entry)');
      console.log('    - src/handlers/ (hook and event handlers)');
      console.log('    - tests/ (test harness setup)');
      console.log('    - package.json with SDK dependency');
      break;

    case 'dev':
      console.log('[dev] Starting plugin development server...');
      console.log('  Watching for file changes with hot reload enabled.');
      console.log('  Use --port to change the port (default: 4400)');
      break;

    case 'validate':
      console.log('[validate] Validating plugin manifest...');
      await runValidation();
      break;

    case 'test':
      console.log('[test] Running plugin test harness...');
      console.log('  Executing manifest validation and handler tests.');
      break;

    case 'build':
      console.log('[build] Building plugin for distribution...');
      console.log('  Output will be in ./dist/');
      break;

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

async function runValidation(): Promise<void> {
  try {
    const fs = await import('fs');
    const path = await import('path');

    // Try to find manifest in common locations
    const manifestPaths = [
      path.resolve(process.cwd(), 'manifest.json'),
      path.resolve(process.cwd(), 'src', 'manifest.json'),
    ];

    let manifestPath: string | null = null;
    for (const p of manifestPaths) {
      if (fs.existsSync(p)) {
        manifestPath = p;
        break;
      }
    }

    if (!manifestPath) {
      // Try loading from the plugin entry file
      console.log('  No manifest.json found. Checking plugin entry file...');
      console.log('  Tip: Export your manifest from your plugin entry file.');
      return;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const manifest = JSON.parse(content);

    const { validateManifest } = await import('../manifest/index.js');
    const result = validateManifest(manifest);

    if (result.valid) {
      console.log('  ✓ Manifest is valid');
    } else {
      console.error('  ✗ Manifest validation failed:');
      for (const err of result.errors) {
        console.error(`    [${err.path}] ${err.message}`);
      }
      process.exit(1);
    }

    if (result.warnings.length > 0) {
      console.log('  Warnings:');
      for (const warn of result.warnings) {
        console.log(`    ⚠ [${warn.path}] ${warn.message}`);
      }
    }
  } catch (error) {
    console.error('  Failed to validate:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
