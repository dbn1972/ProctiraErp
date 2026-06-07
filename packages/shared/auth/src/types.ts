/**
 * Auth types and interfaces for the ProctiraERP platform.
 * These are shared between backend auth service and any consumer.
 */

/**
 * Role assignment scoped to an area hierarchy node and optionally an institution.
 */
export interface RoleAssignment {
  roleId: string;
  roleName: string;
  /** Area hierarchy node this role is scoped to */
  areaId: string;
  /** Optional institution scope */
  institutionId?: string;
}

/**
 * Area scope for permission evaluation.
 */
export interface AreaScope {
  areaId: string;
  level: number;
}

/**
 * Authenticated user information stored in JWT payload.
 */
export interface AuthUser {
  /** User ID (sub claim) */
  userId: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** User's email address */
  email: string;
  /** User's display name */
  displayName: string;
  /** Assigned roles with area/institution scoping */
  roles: RoleAssignment[];
  /** Area scopes for permission evaluation */
  areas: AreaScope[];
  /** Institution IDs the user has access to */
  institutions: string[];
}

/**
 * JWT payload structure for access tokens.
 */
export interface JwtPayload {
  /** Subject - User ID */
  sub: string;
  /** Tenant ID for multi-tenant isolation */
  tenantId: string;
  /** User email */
  email: string;
  /** Display name */
  displayName: string;
  /** Role assignments */
  roles: RoleAssignment[];
  /** Area scopes */
  areas: AreaScope[];
  /** Institution IDs */
  institutions: string[];
  /** Issued at (Unix timestamp) */
  iat: number;
  /** Expiration (Unix timestamp) */
  exp: number;
  /** JWT ID */
  jti: string;
  /** Session ID */
  sessionId: string;
}

/**
 * Token pair returned on successful authentication or refresh.
 */
export interface TokenPair {
  /** JWT access token */
  accessToken: string;
  /** Opaque refresh token (UUID) */
  refreshToken: string;
  /** Access token expiration in seconds */
  expiresIn: number;
  /** Token type (always "Bearer") */
  tokenType: 'Bearer';
}

/**
 * Refresh token stored in PostgreSQL.
 */
export interface RefreshToken {
  /** Unique refresh token ID */
  id: string;
  /** The opaque token value (UUID) */
  token: string;
  /** User ID this token belongs to */
  userId: string;
  /** Tenant ID for isolation */
  tenantId: string;
  /** Associated session ID */
  sessionId: string;
  /** When the token expires */
  expiresAt: Date;
  /** Whether the token has been revoked */
  revoked: boolean;
  /** When the token was revoked (if applicable) */
  revokedAt?: Date;
  /** Reason for revocation */
  revokedReason?: string;
  /** The token that replaced this one (for rotation tracking) */
  replacedByToken?: string;
  /** When the token was created */
  createdAt: Date;
  /** IP address of the client that created this token */
  createdByIp?: string;
}

/**
 * User session valid across all platform modules.
 */
export interface Session {
  /** Unique session ID */
  id: string;
  /** User ID */
  userId: string;
  /** Tenant ID for isolation */
  tenantId: string;
  /** When the session was created */
  createdAt: Date;
  /** When the session expires */
  expiresAt: Date;
  /** Last activity timestamp */
  lastActivityAt: Date;
  /** Whether the session is active */
  isActive: boolean;
  /** Device/user agent information */
  userAgent?: string;
  /** IP address */
  ipAddress?: string;
  /** When the session was invalidated */
  invalidatedAt?: Date;
}

/**
 * Authentication credentials for different providers.
 */
export interface AuthCredentials {
  type: 'local' | 'oauth2' | 'oidc' | 'saml';
  /** Username or email for local auth */
  username?: string;
  /** Password for local auth */
  password?: string;
  /** OAuth/OIDC provider name */
  provider?: string;
  /** OAuth/OIDC token from callback */
  token?: string;
  /** SAML response XML */
  samlResponse?: string;
}

/**
 * Result of a successful authentication.
 */
export interface AuthResult {
  /** Token pair (access + refresh) */
  tokens: TokenPair;
  /** Created session */
  session: Session;
  /** Authenticated user info */
  user: AuthUser;
}

/**
 * Login request body.
 */
export interface LoginRequest {
  /** Username or email */
  username: string;
  /** Password */
  password: string;
}

/**
 * Refresh token request body.
 */
export interface RefreshRequest {
  /** The refresh token to use */
  refreshToken: string;
}
