/**
 * Local credential authentication with bcrypt password hashing.
 */
import { DEFAULT_SALT_ROUNDS } from '@proctira/auth';
import bcrypt from 'bcryptjs';

/**
 * Hash a plaintext password using bcrypt.
 * @param password - The plaintext password to hash
 * @param saltRounds - Number of bcrypt salt rounds (default 12)
 * @returns The hashed password string
 */
export async function hashPassword(
  password: string,
  saltRounds: number = DEFAULT_SALT_ROUNDS,
): Promise<string> {
  return bcrypt.hash(password, saltRounds);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * @param password - The plaintext password to verify
 * @param hash - The bcrypt hash to compare against
 * @returns True if the password matches the hash
 */
export async function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}
