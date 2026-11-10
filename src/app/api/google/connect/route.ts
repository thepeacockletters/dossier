import { NextResponse } from "next/server";

import { loadGoogleAccount } from "@/lib/google/account";
import { ALL_SCOPES, authorizeUrl, googleClient, redirectUri, SCOPES, signState, type ScopeGroup } from "@/lib/google/oauth";
import { publicOrigin } from "@/lib/google/origin";
import { route } from "@/lib/route";

const GROUPS: readonly ScopeGroup[] = ["send", "calendar"];

/** Where to come back to: Settings → Google, or the setup guide (E21-5) when it asks. */
function returnTo(request: Request): string {
  const asked = new URL(request.url).searchParams.get("return");
  return asked && /^\/welcome(\?|$)/.test(asked) ? asked : "/settings?section=google";
}

/**
 * Starts connecting Google (E15-1): `?scopes=send,calendar` picks the
 * features, added to what was granted before and is still used; `?return=` the setup guide, to
 * come back to it. Sends the browser to Google's consent page, which comes
 * back to /api/google/callback.
 */
export const GET = route(async (request) => {
  const client = await googleClient();
  const back = returnTo(request);
  if (!client) {
    const url = new URL(back, publicOrigin(request));
    url.searchParams.set("google", "not-configured");
    return NextResponse.redirect(url);
  }
  const asked = (request.nextUrl.searchParams.get("scopes") ?? GROUPS.join(","))
    .split(",")
    .filter((group): group is ScopeGroup => (GROUPS as readonly string[]).includes(group));
  const account = await loadGoogleAccount();
  // Scopes granted before that Dossier no longer uses (Gmail reading) aren't asked for again.
  const kept = (account?.scopes.split(/\s+/) ?? []).filter((scope) => ALL_SCOPES.includes(scope));
  const scopes = [...new Set([...SCOPES.identity, ...kept, ...asked.flatMap((group) => SCOPES[group])])];
  const state = await signState(back);
  return NextResponse.redirect(authorizeUrl({ clientId: client.id, redirect: redirectUri(publicOrigin(request)), state, scopes }));
});
