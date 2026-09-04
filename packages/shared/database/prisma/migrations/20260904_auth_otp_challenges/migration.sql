-- MFA SMS OTP challenges (hashed codes + expiry) in the auth schema.
CREATE TABLE IF NOT EXISTS auth.otp_challenges (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mfa_token VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(255) NOT NULL,
  tenant_id UUID NOT NULL,
  phone VARCHAR(32) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS otp_challenges_tenant_user_idx
  ON auth.otp_challenges (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS otp_challenges_expires_at_idx
  ON auth.otp_challenges (expires_at);
