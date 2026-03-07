/**
 * Module-level cache of Satori platform features per account.
 *
 * Populated from the READY event's login.features list when the WebSocket
 * connects. Used by the actions adapter to gate tool availability.
 *
 * Key: accountId (string)
 * Value: Set of feature strings (e.g. "reaction.create", "message.list")
 */
const featureCache = new Map<string, Set<string>>();

export function setAccountFeatures(accountId: string, features: string[]): void {
  featureCache.set(accountId, new Set(features));
}

export function getAccountFeatures(accountId: string): Set<string> {
  return featureCache.get(accountId) ?? new Set();
}

export function hasFeature(accountId: string, feature: string): boolean {
  const cached = featureCache.get(accountId);
  if (!cached) return false; // features not yet known; deny until populated
  return cached.has(feature);
}
