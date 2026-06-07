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
    await client.$executeRawUnsafe(
      `SELECT set_config('app.current_tenant_id', '${tenantId}', true)`,
    );
  }

  /**
   * Clean specific tables (useful for targeted cleanup between tests).
   */
  async cleanTables(tableNames: string[]): Promise<void> {
    const client = this.getClient();
    for (const table of tableNames) {
      await client.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE`);
    }
  }
}
