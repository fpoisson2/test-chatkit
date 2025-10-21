import { describe, expect, it } from "vitest";

import { normalizeSessionExpiration } from "../chatkitSession";

describe("normalizeSessionExpiration", () => {
  it("retourne l'horodatage correspondant à une chaîne ISO", () => {
    const iso = "2024-01-01T00:00:00Z";
    expect(normalizeSessionExpiration(iso)).toBe(Date.parse(iso));
  });

  it("découvre une expiration dans une structure imbriquée", () => {
    const iso = "2025-05-20T08:30:00Z";
    expect(normalizeSessionExpiration({ expires_at: iso })).toBe(Date.parse(iso));
    expect(normalizeSessionExpiration({ expiresAt: iso })).toBe(Date.parse(iso));
  });

  it("renvoie null pour les valeurs non interprétables", () => {
    expect(normalizeSessionExpiration({})).toBeNull();
    expect(normalizeSessionExpiration("not-a-date")).toBeNull();
  });
});
