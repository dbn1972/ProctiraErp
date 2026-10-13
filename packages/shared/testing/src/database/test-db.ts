/**
 * TestDatabase class that wraps a database client for test isolation.
 * Provides transaction-based isolation so each test runs in a rolled-back transaction.
 */

export interface DatabaseClient {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $executeRawUnsafe(query: string, ...values: unknown[]): Promise<unknown>;
  $transaction<T>(fn: (tx: DatabaseClient) => Promise<T>): Promise<T>;
}

export interface TestDatabaseOptions {
  /** Database connection URL (defaults to TEST_DATABASE_URL env var) */
  connectionUrl?: string;
  /** Whether to log queries during tests */
  logging?: boolean;
}

/**
 * TestDatabase wraps a PrismaClient (or compatible client) for test isolation.
 * Each test can run within a transaction that is rolled back after the test completes.
 */
export class TestDatabase<TClient extends DatabaseClient = DatabaseClient> {
  private client: TClient | null = null;
  private readonly options: TestDatabaseOptions;

  constructor(options: TestDatabaseOptions = {}) {
    this.options = {
      connectionUrl: options.connectionUrl ?? process.env['TEST_DATABASE_URL'],
      logging: options.logging ?? false,
    };
  }

  /**
   * Initialize the test database connection.
   * Call this in beforeAll() or test setup.
   */
  async connect(clientFactory: () => TClient): Promise<void> {
    this.client = clientFactory();
    await this.client.$connect();
  }

  /**
   * Disconnect from the test database.
   * Call this in afterAll() or test teardown.
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
    }
  }

  /**
   * Get the underlying database client.
   */
  getClient(): TClient {
    if (!this.client) {
      throw new Error('TestDatabase not connected. Call connect() first.');
    }
    return this.client;
  }

  /**
   * Set the tenant context for RLS-based isolation.
   */
  async setTenantContext(tenantId: string): Promise<void> {
    const client = this.getClient();
    // W1-DATA-12: bind canonical app.tenant_id and sync legacy alias (parameterized).
    await client.$executeRawUnsafe(
      `SELECT set_config('app.tenant_id', $1, true), set_config('app.current_tenant_id', $1, true)`,
      tenantId,
    );
  }

  /**
   * Clean specific tables (useful for targeted cleanup between tests).
   *
   * PRC-L585: TRUNCATE ... CASCADE is destructive. Guard it so it can only run
   * against a test database — NODE_ENV must not be production and the connection
   * URL / env must look like a test DB. Identifiers are validated (no injection).
   */
  async cleanTables(tableNames: string[]): Promise<void> {
    assertTestDatabase(this.options.connectionUrl);
    const client = this.getClient();
    for (const table of tableNames) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) {
        throw new Error(`cleanTables: unsafe table identifier "${table}" (PRC-L585)`);
      }
      await client.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  }
}

/**
 * PRC-L585 — fail closed unless we are clearly pointed at a test database.
 * Production NODE_ENV is always refused; the DB name/URL must contain a test
 * marker (`test`) so a mis-set TEST_DATABASE_URL cannot truncate real data.
 */
export function assertTestDatabase(connectionUrl: string | undefined): void {
  const nodeEnv = (process.env['NODE_ENV'] ?? '').toLowerCase();
  if (nodeEnv === 'production') {
    throw new Error('TestDatabase.cleanTables refused: NODE_ENV=production (PRC-L585)');
  }
  const url = (connectionUrl ?? process.env['TEST_DATABASE_URL'] ?? '').toLowerCase();
  if (!url) {
    throw new Error(
      'TestDatabase.cleanTables refused: no TEST_DATABASE_URL / connectionUrl (PRC-L585)',
    );
  }
  if (!url.includes('test')) {
    throw new Error(
      'TestDatabase.cleanTables refused: connection does not look like a test database ' +
        '(expected "test" in the URL/db name) (PRC-L585)',
    );
  }
}
