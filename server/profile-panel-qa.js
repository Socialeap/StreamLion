// Operator-configured, profile-panel-only QA. Never a purchase or workspace grant.
export function profilePanelQa(env, identity, now = Date.now()) {
  try {
    if (
      env.STREAMLION_PAYMENTS_MODE !== "live" ||
      env.STREAMLION_CHECKOUT_MODE !== "paused" ||
      env.GOOGLE_AUTH_ORIGIN !== "https://streamlion.transcendencemedia.com" ||
      !identity?.google_subject ||
      !identity.email ||
      typeof env.STREAMLION_PROFILE_PANEL_QA !== "string" ||
      env.STREAMLION_PROFILE_PANEL_QA.length > 2048
    )
      return null;
    const g = JSON.parse(env.STREAMLION_PROFILE_PANEL_QA);
    if (
      g.version !== 1 ||
      g.scope !== "profile-panel" ||
      g.subject !== identity.google_subject ||
      g.email !== identity.email ||
      !Number.isSafeInteger(g.issuedAt) ||
      !Number.isSafeInteger(g.expiresAt) ||
      g.issuedAt <= 0 ||
      g.issuedAt > now ||
      g.expiresAt <= now ||
      g.expiresAt <= g.issuedAt ||
      g.expiresAt - g.issuedAt > 3600000
    )
      return null;
    return { scope: "profile-panel", expiresAt: g.expiresAt };
  } catch {
    return null;
  }
}
