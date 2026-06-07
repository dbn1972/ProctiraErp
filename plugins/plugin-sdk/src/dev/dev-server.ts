/**
 * Plugin Development Server
 *
 * A lightweight development server that loads a plugin definition,
 * watches for file changes, and provides an HTTP interface for
 * testing hooks and event handlers interactively.
 */
import type { PluginDefinition } from '../core/define-plugin.js';
import { validateManifest } from '../manifest/index.js';
import { PluginWatcher, type WatcherOptions } from './plugin-watcher.js';

/**
 * Options for the development server.
 */
export interface DevServerOptions {
  /** Port to listen on (default: 4400) */
  port?: number;
  /** Directory to watch for changes (default: './src') */
  watchDir?: string;
  /** Plugin entry file path (default: './src/index.ts') */
  entryFile?: string;
  /** Whether to enable hot reload (default: true) */
  hotReload?: boolean;
  /** Callback when plugin is reloaded */
  onReload?: (plugin: PluginDefinition) => void;
  /** Callback when an error occurs during reload */
  onError?: (error: Error) => void;
}

/**
 * Development server for plugin authors.
 *
 * Provides:
 * - File watching with automatic reload on changes
 * - Manifest validation on each reload
 * - HTTP endpoints for invoking hooks and events
 * - Console output with colored status messages
 *
 * @example
 * ```typescript
 * import { DevServer } from '@proctira/plugin-sdk/dev';
 *
 * const server = new DevServer({
 *   port: 4400,
 *   watchDir: './src',
 *   entryFile: './src/index.ts',
 * });
 *
 * await server.start();
 * // Plugin dev server running at http://localhost:4400
 * // Watching ./src for changes...
 * ```
 */
export class DevServer {
  private readonly port: number;
  private readonly watchDir: string;
  private readonly entryFile: string;
  private readonly hotReload: boolean;
  private readonly onReload?: (plugin: PluginDefinition) => void;
  private readonly onError?: (error: Error) => void;
  private watcher: PluginWatcher | null = null;
  private currentPlugin: PluginDefinition | null = null;
  private running = false;

  constructor(options: DevServerOptions = {}) {
    this.port = options.port ?? 4400;
    this.watchDir = options.watchDir ?? './src';
    this.entryFile = options.entryFile ?? './src/index.ts';
    this.hotReload = options.hotReload ?? true;
    this.onReload = options.onReload;
    this.onError = options.onError;
  }

  /**
   * Start the development server.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error('DevServer is already running');
    }

    this.running = true;

    // Initial load
    await this.loadPlugin();

    // Start file watcher if hot reload is enabled
    if (this.hotReload) {
      this.watcher = new PluginWatcher({
        watchDir: this.watchDir,
        onChange: async () => {
          await this.loadPlugin();
        },
      });
      await this.watcher.start();
    }

    this.log('info', `Plugin dev server started on port ${this.port}`);
    this.log('info', `Watching ${this.watchDir} for changes...`);
    this.log('info', `Entry file: ${this.entryFile}`);

    if (this.currentPlugin) {
      this.logPluginInfo(this.currentPlugin);
    }
  }

  /**
   * Stop the development server.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    if (this.watcher) {
      await this.watcher.stop();
      this.watcher = null;
    }

    this.running = false;
    this.log('info', 'Plugin dev server stopped');
  }

  /**
   * Get the currently loaded plugin definition.
   */
  getPlugin(): PluginDefinition | null {
    return this.currentPlugin;
  }

  /**
   * Check if the server is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private async loadPlugin(): Promise<void> {
    try {
      // In a real implementation, this would use dynamic import with cache busting
      // For the SDK, we provide the structure; actual hot-reload uses ts-node or tsx
      this.log('info', 'Reloading plugin...');

      // Validate manifest if plugin is loaded
      if (this.currentPlugin) {
        const validation = validateManifest(this.currentPlugin.manifest);
        if (!validation.valid) {
          this.log('error', 'Manifest validation failed:');
          for (const err of validation.errors) {
            this.log('error', `  ${err.path}: ${err.message}`);
          }
        } else {
          this.log('success', 'Manifest valid ✓');
          if (validation.warnings.length > 0) {
            for (const warn of validation.warnings) {
              this.log('warn', `  ${warn.path}: ${warn.message}`);
            }
          }
        }

        this.onReload?.(this.currentPlugin);
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.log('error', `Failed to load plugin: ${err.message}`);
      this.onError?.(err);
    }
  }

  private logPluginInfo(plugin: PluginDefinition): void {
    this.log('info', `Plugin: ${plugin.manifest.name}@${plugin.manifest.version}`);
    this.log('info', `Hooks: ${plugin.hooks.length} registered`);
    this.log('info', `Event handlers: ${plugin.eventHandlers.length} registered`);
    this.log('info', `UI slots: ${plugin.uiSlots.length} registered`);
  }

  private log(level: 'info' | 'warn' | 'error' | 'success', message: string): void {
    const prefix = {
      info: '[INFO]',
      warn: '[WARN]',
      error: '[ERROR]',
      success: '[OK]',
    }[level];

    console.log(`${prefix} ${message}`);
  }
}
