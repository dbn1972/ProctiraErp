/**
 * RedactedSecret wraps a secret value to prevent accidental exposure
 * through logging, serialization, or string coercion.
 *
 * Security properties:
 * - toString() returns '[REDACTED]'
 * - toJSON() returns '[REDACTED]'
 * - inspect() returns '[REDACTED]'
 * - The actual value is only accessible via the explicit .expose() method
 * - Cannot be enumerated or spread into other objects accidentally
 */

const REDACTED_PLACEHOLDER = '[REDACTED]';

export class RedactedSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;

    // Prevent the value from appearing in JSON serialization
    Object.defineProperty(this, 'toJSON', {
      value: () => REDACTED_PLACEHOLDER,
      enumerable: false,
      writable: false,
      configurable: false,
    });
  }

  /**
   * Explicitly retrieve the secret value.
   * This is the ONLY way to access the underlying secret.
   * Use with care — never pass the result to a logger or serializer.
   */
  expose(): string {
    return this.#value;
  }

  /**
   * Returns a redacted placeholder. Prevents accidental logging via string coercion.
   */
  toString(): string {
    return REDACTED_PLACEHOLDER;
  }

  /**
   * Returns a redacted placeholder. Prevents accidental logging via JSON.stringify.
   */
  toJSON(): string {
    return REDACTED_PLACEHOLDER;
  }

  /**
   * Returns a redacted placeholder for Node.js util.inspect.
   */
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED_PLACEHOLDER;
  }

  /**
   * Returns the length of the secret without exposing its content.
   */
  get length(): number {
    return this.#value.length;
  }

  /**
   * Check if the secret is empty.
   */
  get isEmpty(): boolean {
    return this.#value.length === 0;
  }
}

/**
 * Creates a RedactedSecret from a plain string value.
 */
export function redact(value: string): RedactedSecret {
  return new RedactedSecret(value);
}

/**
 * Type guard to check if a value is a RedactedSecret.
 */
export function isRedactedSecret(value: unknown): value is RedactedSecret {
  return value instanceof RedactedSecret;
}
