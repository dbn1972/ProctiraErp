/**
 * External Auth Handler
 *
 * Orchestrates the external authentication flow:
 * 1. Initiates auth with the external provider
 * 2. Handles the callback from the provider
 * 3. Links the external identity to a platform user (or creates one)
 * 4. Issues platform JWT tokens and creates a session
 *
 * This handler bridges external identity providers with the platform's
 * internal auth system (TokenService + SessionService).
 */
import type { AuthUser, TokenPair } from '@proctira/auth';
import type { ExternalUserProfile, AuthCallbackParams } from './types.js';
import { ExternalAuthError } from './types.js';
import type { ProviderRegistry } from './provider-registry.js';
import type { TokenService } from '../token-service.js';
import type { SessionService } from '../session-service.js';

/**
 * Represents a linked external identity in the platform.
 */
export interface ExternalIdentityLink {
  /** Platform user ID */
  userId: string;
  /** Tenant ID */
  tenantId: string;
  /** External provider ID (e.g., 'google', 'microsoft') */
  providerId: string;
  /** External user ID from the provider */
  externalId: string;
  /** Email from the external provider */
  email: string;
  /** When the link was created */
  createdAt: Date;
  /** When the link was last used */
  lastUsedAt: Date;
}

/**
 * Interface for managing external identity links (provided by consuming application).
 * Maps external provider identities to platform users.
 */
export interface ExternalIdentityStore {
  /**
   * Find an existing identity link by provider and external ID.
   */
  findByExternalId(
    providerId: string,
    externalId: string,
    tenantId: string,
  ): Promise<ExternalIdentityLink | null>;

  /**
   * Find an existing identity link by email within a tenant.
   */
  findByEmail(
    email: string,
    tenantId: string,
  ): Promise<ExternalIdentityLink | null>;

  /**
   * Create a new identity link.
   */
  create(link: Omit<ExternalIdentityLink, 'createdAt' | 'lastUsedAt'>): Promise<ExternalIdentityLink>;

  /**
   * Update the last used timestamp for an identity link.
   */
  updateLastUsed(providerId: string, externalId: string, tenantId: string): Promise<void>;
}

/**
 * Interface for looking up platform users (provided by consuming application).
 */
export interface ExternalAuthUserLookup {
  /**
   * Find a platform user by ID.
   */
  findById(userId: string, tenantId: string): Promise<AuthUser | null>;

  /**
   * Find a platform user by email.
   */
  findByEmail(email: string, tenantId: string): Promise<AuthUser | null>;

  /**
   * Create a new platform user from an external profile.
   * Called when auto-provisioning is enabled and no existing user is found.
   */
  createFromExternalProfile(
    profile: ExternalUserProfile,
    tenantId: string,
    providerId: string,
  ): Promise<AuthUser>;
}

/**
 * Configuration for the external auth handler.
 */
export interface ExternalAuthHandlerConfig {
  /**
   * Whether to auto-provision new users from external providers.
   * If false, users must be pre-created in the platform.
   */
  autoProvisionUsers: boolean;

  /**
   * Whether to link by email when no external ID link exists.
   * If true, will match existing platform users by email.
   */
  linkByEmail: boolean;
}

/**
 * Result of a successful external authentication.
 */
export interface ExternalAuthResult {
  /** Platform token pair (access + refresh) */
  tokens: TokenPair;
  /** Session info */
  session: { id: string; expiresAt: string };
  /** Authenticated platform user */
  user: AuthUser;
  /** Whether this was a new user (auto-provisioned) */
  isNewUser: boolean;
  /** The external provider that authenticated the user */
  providerId: string;
}

/**
 * External Auth Handler - bridges external providers with platform auth.
 */
export class ExternalAuthHandler {
  constructor(
    private readonly providerRegistry: ProviderRegistry,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly identityStore: ExternalIdentityStore,
    private readonly userLookup: ExternalAuthUserLookup,
    private readonly config: ExternalAuthHandlerConfig = {
      autoProvisionUsers: true,
      linkByEmail: true,
    },
  ) {}

  /**
   * Initiate authentication with an external provider.
   * Returns the redirect URL for the user.
   */
  async initiateAuth(providerId: string, tenantId: string): Promise<{ redirectUrl: string; state: string }> {
    const provider = this.providerRegistry.getProvider(providerId);
    const result = await provider.initiateAuth(tenantId);
    return { redirectUrl: result.redirectUrl, state: result.state };
  }

  /**
   * Handle the callback from an external provider.
   * Validates the response, resolves/creates the platform user, and issues tokens.
   */
  async handleCallback(
    providerId: string,
    params: AuthCallbackParams,
    tenantId: string,
    clientInfo?: { userAgent?: string; ipAddress?: string },
  ): Promise<ExternalAuthResult> {
    // Get the provider and handle the callback
    const provider = this.providerRegistry.getProvider(providerId);
    const profile = await provider.handleCallback(params, tenantId);

    // Resolve or create the platform user
    const { user, isNewUser } = await this.resolveUser(profile, providerId, tenantId);

    // Update identity link last used timestamp
    await this.identityStore.updateLastUsed(providerId, profile.externalId, tenantId);

    // Create a platform session
    const session = await this.sessionService.createSession(user.userId, tenantId, {
      userAgent: clientInfo?.userAgent,
      ipAddress: clientInfo?.ipAddress,
    });

    // Issue platform JWT tokens
    const tokens = await this.tokenService.issueTokenPair(
      user,
      session.id,
      clientInfo?.ipAddress,
    );

    return {
      tokens,
      session: {
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
      },
      user,
      isNewUser,
      providerId,
    };
  }

  /**
   * Resolve an external profile to a platform user.
   * Tries to find an existing link, then matches by email, then auto-provisions.
   */
  private async resolveUser(
    profile: ExternalUserProfile,
    providerId: string,
    tenantId: string,
  ): Promise<{ user: AuthUser; isNewUser: boolean }> {
    // 1. Check for existing identity link by external ID
    const existingLink = await this.identityStore.findByExternalId(
      providerId,
      profile.externalId,
      tenantId,
    );

    if (existingLink) {
      const user = await this.userLookup.findById(existingLink.userId, tenantId);
      if (user) {
        return { user, isNewUser: false };
      }
      // Link exists but user was deleted - fall through to create/link
    }

    // 2. Try to match by email if configured
    if (this.config.linkByEmail) {
      const userByEmail = await this.userLookup.findByEmail(profile.email, tenantId);
      if (userByEmail) {
        // Create identity link for this user
        await this.identityStore.create({
          userId: userByEmail.userId,
          tenantId,
          providerId,
          externalId: profile.externalId,
          email: profile.email,
        });
        return { user: userByEmail, isNewUser: false };
      }
    }

    // 3. Auto-provision if enabled
    if (this.config.autoProvisionUsers) {
      const newUser = await this.userLookup.createFromExternalProfile(
        profile,
        tenantId,
        providerId,
      );

      // Create identity link
      await this.identityStore.create({
        userId: newUser.userId,
        tenantId,
        providerId,
        externalId: profile.externalId,
        email: profile.email,
      });

      return { user: newUser, isNewUser: true };
    }

    // No user found and auto-provisioning is disabled
    throw new ExternalAuthError(
      `No platform account found for ${profile.email}. Contact your administrator to create an account.`,
      providerId,
      'USER_NOT_FOUND',
      403,
    );
  }

  /**
   * Get available external providers for a tenant.
   */
  listProviders(): Array<{ providerId: string; type: string; displayName: string }> {
    return this.providerRegistry.listProviders();
  }
}
