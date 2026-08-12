/** Real-money referral program constants */

/** Free entry stake granted to the referrer when a friend qualifies */
export const REFERRAL_REWARD_REFERRER_STAKE = 5;

/** Free entry stake granted to the referred user when they qualify */
export const REFERRAL_REWARD_REFERRED_STAKE = 1;

/**
 * Optional expiry for free-entry credits (days).
 * Set to 0 for no expiry. MVP uses 30.
 */
export const REFERRAL_CREDIT_EXPIRY_DAYS = 30;

export type ReferralStatusId = 'PENDING' | 'QUALIFIED' | 'REWARDED';

export type FreeEntryCreditSourceId =
  | 'REFERRAL_REFERRER'
  | 'REFERRAL_REFERRED';

export type FreeEntryCreditStatusId =
  | 'AVAILABLE'
  | 'USED'
  | 'EXPIRED'
  | 'CANCELLED';
