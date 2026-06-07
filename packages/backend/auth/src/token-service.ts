/**
 * Token Service - JWT issuance, refresh token rotation, and revocation.
 *
 * Access tokens are short-lived JWTs containing userId, tenantId, roles.
 * Refresh tokens are opaque UUIDs stored in PostgreSQL with expiry and revocation status.
 * On refresh: old refresh token is revoked, new pair (access + refresh) is issued.
 */
import type {
  AuthUser,
  JwtPayload,
  TokenPair,
  RefreshToken,
  AuthConfig,
} from '@proctira/auth';
import { v4 as uuidv4 } from 'uuid';

/**
 * Interface for JWT signing/verification (provided by @fastify/jwt).
 */
export interface JwtSigner {
  sign(payload: Record<string, unknown>, options?: { expiresIn: number }): string;
  verify<T = JwtPayload>(token: string): T;
}

/**
 * Interface for refresh token storage (PostgreSQL).
 */
export interface RefreshTokenStore {
  /** Store a new refresh token */
  create(token: Omit<RefreshToken, 'id' | 'createdAt'>): Promise<RefreshToken>;
  /** Find a refresh token by its token value */
  findByToken(token: string): Promise<RefreshToken | null>;
  /** Revoke a refresh token */
  revoke(token: string, reason: string, replacedByToken?: string): Promise<void>;
  /** Revoke all refresh tokens for a session */
  revokeAllForSession(sessionId: string, reason: string): Promise<void>;
  /** Revoke all refresh tokens for a user in a tenant */
  revokeAllForUser(userId: string, tenantId: string, reason: string): Promise<void>;
}

/**
 * Token Service handles JWT access token issuance and refresh token rotation.
 */
export class TokenService {
  constructor(
    private readonly config: AuthConfig,
    private readonly jwtSigner: JwtSigner,
    private readonly refreshTokenStore: RefreshTokenStore,
  ) {}

  /**
   * Issue a new token pair (access token + refresh token).
   */
  async issueTokenPair(
    user: AuthUser,
    sessionId: string,
    clientIp?: string,
  ): Promise<TokenPair> {
    const jti = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    // Build JWT payload
    const payload: Record<string, unknown> = {
      sub: user.userId,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      areas: user.areas,
      institutions: user.institutions,
      jti,
      sessionId,
      iat: now,
    };

    // Sign access token
    const accessToken = this.jwtSigner.sign(payload, {
      expiresIn: this.config.jwt.accessTokenExpiresIn,
    });

    // Generate opaque refresh token
    const refreshTokenValue = uuidv4();
    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshToken.maxLifetime * 1000,
    );

    // Store refresh token in database
    await this.refreshTokenStore.create({
      token: refreshTokenValue,
      userId: user.userId,
      tenantId: user.tenantId,
      sessionId,
      expiresAt: refreshExpiresAt,
      revoked: false,
      createdByIp: clientIp,
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      expiresIn: this.config.jwt.accessTokenExpiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Refresh a token pair using a valid refresh token.
   * Implements refresh token rotation: old token is revoked, new pair is issued.
   *
   * @throws Error if refresh token is invalid, expired, or revoked
   */
  async refreshTokenPair(
    refreshToken: string,
    user: AuthUser,
    clientIp?: string,
  ): Promise<TokenPair> {
    // Look up the refresh token
    const storedToken = await this.refreshTokenStore.findByToken(refreshToken);

    if (!storedToken) {
      throw new InvalidRefreshTokenError('Refresh token not found');
    }

    if (storedToken.revoked) {
      // Potential token reuse attack - revoke all tokens for this session
      await this.refreshTokenStore.revokeAllForSession(
        storedToken.sessionId,
        'Token reuse detected',
      );
      throw new InvalidRefreshTokenError('Refresh token has been revoked (possible token reuse)');
    }

    if (storedToken.expiresAt < new Date()) {
      // Token expired - revoke it and all session tokens
      await this.refreshTokenStore.revokeAllForSession(
        storedToken.sessionId,
        'Refresh token expired',
      );
      throw new InvalidRefreshTokenError('Refresh token has expired');
    }

    // Verify tenant isolation
    if (storedToken.tenantId !== user.tenantId) {
      throw new InvalidRefreshTokenError('Refresh token tenant mismatch');
    }

    // Revoke the old refresh token (rotation)
    const newRefreshTokenValue = uuidv4();
    await this.refreshTokenStore.revoke(
      refreshToken,
      'Rotated',
      newRefreshTokenValue,
    );

    // Issue new token pair
    const jti = uuidv4();
    const now = Math.floor(Date.now() / 1000);

    const payload: Record<string, unknown> = {
      sub: user.userId,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      roles: user.roles,
      areas: user.areas,
      institutions: user.institutions,
      jti,
      sessionId: storedToken.sessionId,
      iat: now,
    };

    const accessToken = this.jwtSigner.sign(payload, {
      expiresIn: this.config.jwt.accessTokenExpiresIn,
    });

    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshToken.maxLifetime * 1000,
    );

    await this.refreshTokenStore.create({
      token: newRefreshTokenValue,
      userId: user.userId,
      tenantId: user.tenantId,
      sessionId: storedToken.sessionId,
      expiresAt: refreshExpiresAt,
      revoked: false,
      createdByIp: clientIp,
    });

    return {
      accessToken,
      refreshToken: newRefreshTokenValue,
      expiresIn: this.config.jwt.accessTokenExpiresIn,
      tokenType: 'Bearer',
    };
  }

  /**
   * Revoke a specific refresh token.
   */
  async revokeRefreshToken(token: string, reason: string): Promise<void> {
    await this.refreshTokenStore.revoke(token, reason);
  }

  /**
   * Revoke all refresh tokens for a session.
   */
  async revokeAllSessionTokens(sessionId: string, reason: string): Promise<void> {
    await this.refreshTokenStore.revokeAllForSession(sessionId, reason);
  }

  /**
   * Revoke all refresh tokens for a user in a tenant.
   */
  async revokeAllUserTokens(userId: string, tenantId: string, reason: string): Promise<void> {
    await this.refreshTokenStore.revokeAllForUser(userId, tenantId, reason);
  }

  /**
   * Verify and decode an access token.
   */
  verifyAccessToken(token: string): JwtPayload {
    return this.jwtSigner.verify<JwtPayload>(token);
  }
}

/**
 * Error thrown when a refresh token is invalid, expired, or revoked.
 */
export class InvalidRefreshTokenError extends Error {
  public readonly code = 'INVALID_REFRESH_TOKEN';
  public readonly statusCode = 401;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidRefreshTokenError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
