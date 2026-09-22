/**
 * CLI Entry Point - Parses arguments and orchestrates installation.
 *
 * Usage:
 *   proctira-install --config ./install.json
 *   proctira-install --env
 *   proctira-install --interactive
 *   proctira-install --help
 */

import type { CliOptions, InstallConfig, InstallResult } from './types';
import { loadConfigFromFile, loadConfigFromEnv, loadConfigInteractive } from './config-loader';
import { Installer, type InstallerDependencies } from './installer';

const VERSION = '0.1.0';

const HELP_TEXT = `
ProctiraERP Unified Platform - Install CLI v${VERSION}

Usage:
  proctira-install [options]

Options:
  --config <path>     Path to JSON configuration file
  --env               Load configuration from environment variables
  --interactive       Run interactive configuration prompts (default)
  --skip-migrations   Skip database migration step
  --skip-admin        Skip initial admin account creation
  --output <format>   Output format: text (default) or json
  --verbose           Enable verbose logging
  --help              Show this help message
  --version           Show version

Configuration Sources (in priority order):
  1. JSON file (--config)
  2. Environment variables (--env)
  3. Interactive prompts (--interactive or default)

Examples:
  # Install using a config file
  proctira-install --config ./config/install.json

  # Install using environment variables
  proctira-install --env

  # Interactive installation (default)
  proctira-install

  # Install with JSON output (for CI/CD)
  proctira-install --config ./install.json --output json

Environment Variables:
  OPENEMIS_CDN_ADAPTER          CDN adapter type (cloudfront/nginx/custom)
  OPENEMIS_CDN_BASE_URL         CDN base URL
  OPENEMIS_DB_PROVIDER          Database provider (postgresql/mysql)
  OPENEMIS_DB_HOST              Database host
  OPENEMIS_DB_PORT              Database port
  OPENEMIS_DB_NAME              Database name
  OPENEMIS_DB_USERNAME          Database username
  OPENEMIS_DB_PASSWORD          Database password
  OPENEMIS_STORAGE_ADAPTER      Storage adapter (s3/minio)
  OPENEMIS_STORAGE_BUCKET       Storage bucket name
  OPENEMIS_CACHE_ADAPTER        Cache adapter (redis/memory)
  OPENEMIS_CACHE_HOST           Redis host
  OPENEMIS_QUEUE_BACKEND        Queue backend (kafka/rabbitmq/sqs)
  OPENEMIS_ADMIN_USERNAME       Admin email
  OPENEMIS_ADMIN_PASSWORD       Admin password
  OPENEMIS_ADMIN_FIRST_NAME     Admin first name
  OPENEMIS_ADMIN_LAST_NAME      Admin last name
`;

/**
 * Parse command-line arguments into CliOptions.
 */
export function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};
  const args = argv.slice(2); // Skip node and script path

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    switch (arg) {
      case '--config':
      case '-c':
        options.configFile = args[++i];
        break;
      case '--env':
      case '-e':
        options.useEnv = true;
        break;
      case '--interactive':
      case '-i':
        options.interactive = true;
        break;
      case '--skip-migrations':
        options.skipMigrations = true;
        break;
      case '--skip-admin':
        options.skipAdmin = true;
        break;
      case '--output':
      case '-o':
        options.outputFormat = args[++i] as 'text' | 'json';
        break;
      case '--verbose':
      case '-v':
        options.verbose = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--version':
        options.version = true;
        break;
      default:
        if (arg.startsWith('-')) {
          console.error(`Unknown option: ${arg}`);
          console.error('Use --help for usage information');
          process.exitCode = 1;
        }
        break;
    }
  }

  return options;
}

/**
 * Create a console logger with optional verbose mode.
 */
export function createConsoleLogger(verbose: boolean) {
  return {
    info(objOrMsg: string | Record<string, unknown>, msg?: string): void {
      if (typeof objOrMsg === 'string') {
        console.log(objOrMsg);
      } else if (msg) {
        if (verbose) {
          console.log(`[INFO] ${msg}`, objOrMsg);
        } else {
          console.log(msg);
        }
      }
    },
    warn(objOrMsg: string | Record<string, unknown>, msg?: string): void {
      if (typeof objOrMsg === 'string') {
        console.warn(`⚠ ${objOrMsg}`);
      } else if (msg) {
        console.warn(`⚠ ${msg}`, verbose ? objOrMsg : '');
      }
    },
    error(objOrMsg: string | Record<string, unknown>, msg?: string): void {
      if (typeof objOrMsg === 'string') {
        console.error(`✗ ${objOrMsg}`);
      } else if (msg) {
        console.error(`✗ ${msg}`, verbose ? objOrMsg : '');
      }
    },
    debug(objOrMsg: string | Record<string, unknown>, msg?: string): void {
      if (!verbose) return;
      if (typeof objOrMsg === 'string') {
        console.log(`[DEBUG] ${objOrMsg}`);
      } else if (msg) {
        console.log(`[DEBUG] ${msg}`, objOrMsg);
      }
    },
  };
}

/**
 * Format the installation result as a text summary.
 */
export function formatResultText(result: InstallResult): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('╔══════════════════════════════════════════════════╗');
  lines.push('║          Installation Summary                    ║');
  lines.push('╚══════════════════════════════════════════════════╝');
  lines.push('');

  // Overall status
  const statusIcon = result.success ? '✓' : '✗';
  const statusText = result.success ? 'SUCCESS' : 'FAILED';
  lines.push(`  Status: ${statusIcon} ${statusText}`);
  lines.push(`  Completed: ${result.completedAt}`);
  lines.push('');

  // Adapter results
  lines.push('  Adapters:');
  for (const [name, res] of Object.entries(result.adapterResults)) {
    const icon = res.success ? '✓' : '✗';
    const latency = res.latencyMs !== undefined ? ` (${res.latencyMs}ms)` : '';
    lines.push(`    ${icon} ${name}: ${res.message}${latency}`);
  }
  lines.push('');

  // Migrations
  lines.push(`  Migrations: ${result.migrationsRun ? '✓ Applied' : '○ Skipped'}`);

  // Admin account
  lines.push(`  Admin Account: ${result.adminCreated ? '✓ Created' : '○ Skipped'}`);
  lines.push('');

  // Health status
  lines.push(`  Health: ${result.health.status.toUpperCase()}`);
  for (const [name, health] of Object.entries(result.health.adapters)) {
    const icon = health.healthy ? '✓' : '✗';
    lines.push(`    ${icon} ${name}: ${health.message}`);
  }

  if (result.error) {
    lines.push('');
    lines.push(`  Error: ${result.error}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Main CLI execution function.
 */
export async function run(
  argv: string[],
  deps?: Partial<InstallerDependencies>,
): Promise<InstallResult | null> {
  const options = parseArgs(argv);

  // Handle --help
  if (options.help) {
    console.log(HELP_TEXT);
    return null;
  }

  // Handle --version
  if (options.version) {
    console.log(`proctira-install v${VERSION}`);
    return null;
  }

  const logger = createConsoleLogger(options.verbose ?? false);

  // Load configuration based on source
  let config: InstallConfig;

  try {
    if (options.configFile) {
      logger.info(`Loading configuration from file: ${options.configFile}`);
      config = loadConfigFromFile(options.configFile);
    } else if (options.useEnv) {
      logger.info('Loading configuration from environment variables');
      config = loadConfigFromEnv();
    } else if (options.interactive !== false) {
      // Default to interactive mode
      config = await loadConfigInteractive();
    } else {
      console.error('No configuration source specified. Use --config, --env, or --interactive');
      process.exitCode = 1;
      return null;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Configuration loading failed: ${message}`);
    process.exitCode = 1;
    return null;
  }

  // Run installation
  const installer = new Installer({
    logger,
    migrationRunner: deps?.migrationRunner,
    adminCreator: deps?.adminCreator,
  });

  const result = await installer.install(config, {
    skipMigrations: options.skipMigrations,
    skipAdmin: options.skipAdmin,
  });

  // Output result
  if (options.outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatResultText(result));
  }

  if (!result.success) {
    process.exitCode = 1;
  }

  return result;
}
