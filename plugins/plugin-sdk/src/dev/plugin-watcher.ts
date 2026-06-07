/**
 * Plugin File Watcher
 *
 * Watches plugin source files for changes and triggers reload.
 * Uses chokidar for cross-platform file watching with debouncing.
 */

/**
 * Options for the plugin file watcher.
 */
export interface WatcherOptions {
  /** Directory to watch (default: './src') */
  watchDir: string;
  /** File patterns to watch (default: ts and json files) */
  patterns?: string[];
  /** Debounce delay in milliseconds (default: 300) */
  debounceMs?: number;
  /** Callback when files change */
  onChange: (changedFiles: string[]) => void | Promise<void>;
  /** Callback when watcher encounters an error */
  onError?: (error: Error) => void;
}

/**
 * File watcher for plugin hot-reload during development.
 *
 * Watches TypeScript and JSON files in the plugin source directory
 * and triggers a callback when changes are detected. Includes
 * debouncing to avoid excessive reloads during rapid edits.
 *
 * @example
 * ```typescript
 * import { PluginWatcher } from '@proctira/plugin-sdk/dev';
 *
 * const watcher = new PluginWatcher({
 *   watchDir: './src',
 *   onChange: (files) => {
 *     console.log('Changed files:', files);
 *     // Reload plugin...
 *   },
 * });
 *
 * await watcher.start();
 * ```
 */
export class PluginWatcher {
  private readonly watchDir: string;
  private readonly patterns: string[];
  private readonly debounceMs: number;
  private readonly onChange: (changedFiles: string[]) => void | Promise<void>;
  private readonly onError?: (error: Error) => void;
  private watcher: unknown = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingChanges: string[] = [];
  private running = false;

  constructor(options: WatcherOptions) {
    this.watchDir = options.watchDir;
    this.patterns = options.patterns ?? ['**/*.ts', '**/*.json'];
    this.debounceMs = options.debounceMs ?? 300;
    this.onChange = options.onChange;
    this.onError = options.onError;
  }

  /**
   * Start watching for file changes.
   */
  async start(): Promise<void> {
    if (this.running) return;

    try {
      // Dynamic import of chokidar to keep it optional
      const chokidar = await import('chokidar');

      this.watcher = chokidar.watch(this.patterns, {
        cwd: this.watchDir,
        ignoreInitial: true,
        ignored: ['**/node_modules/**', '**/dist/**', '**/.git/**'],
      });

      const fsWatcher = this.watcher as {
        on: (event: string, handler: (...args: unknown[]) => void) => void;
      };

      fsWatcher.on('change', (path: unknown) => this.handleChange(String(path)));
      fsWatcher.on('add', (path: unknown) => this.handleChange(String(path)));
      fsWatcher.on('unlink', (path: unknown) => this.handleChange(String(path)));
      fsWatcher.on('error', (error: unknown) => {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      });

      this.running = true;
    } catch (error) {
      // If chokidar is not available, fall back to polling
      this.running = true;
      console.warn(
        '[PluginWatcher] chokidar not available, file watching disabled. Install chokidar for hot reload.',
      );
    }
  }

  /**
   * Stop watching for file changes.
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    if (this.watcher && typeof (this.watcher as { close?: () => Promise<void> }).close === 'function') {
      await (this.watcher as { close: () => Promise<void> }).close();
    }

    this.watcher = null;
    this.running = false;
    this.pendingChanges = [];
  }

  /**
   * Check if the watcher is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private handleChange(filePath: string): void {
    this.pendingChanges.push(filePath);

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      const changes = [...this.pendingChanges];
      this.pendingChanges = [];

      try {
        await this.onChange(changes);
      } catch (error) {
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
    }, this.debounceMs);
  }
}
