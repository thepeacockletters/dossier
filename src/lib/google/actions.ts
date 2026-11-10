"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { ApplicationStatus } from "@/generated/prisma/enums";
import { action, ActionError } from "@/lib/action";
import { applySecretChange, GOOGLE_CLIENT_SECRET } from "@/lib/secrets";
import { loadSettings, saveSettings } from "@/lib/settings-data";
import { statusInfo } from "@/lib/status";

import { disconnectGoogle } from "./account";
import { GoogleError } from "./errors";
import { loadGoogleClientConfig } from "./oauth";
import { sendApplicationEmail } from "./send";

// Gmail and Calendar from the app (E15). Google's failures reach the user as
// their own message; every send is a separate, confirmed request.

const refreshEverything = () => revalidatePath("/", "layout");

/** Runs `work`, turning a GoogleError into a message for the user. */
async function google<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof GoogleError) throw new ActionError(error.message);
    throw error;
  }
}

/** Settings → Google: what each switch and field saves. */
export const saveGoogleSettings = action(
  z.strictObject({
    calendarEvents: z.boolean().optional(),
    calendarId: z.string().trim().min(1).max(300).optional(),
    workTimeZone: z
      .string()
      .trim()
      .max(100)
      .refine((zone) => {
        if (!zone) return true;
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: zone });
          return true;
        } catch {
          return false;
        }
      }, "That isn't a time zone.")
      .optional(),
    slotMinutes: z.number().int().min(15).max(240).optional(),
  }),
  async ({ workTimeZone, ...changes }) => {
    await saveSettings({ ...changes, ...(workTimeZone === undefined ? {} : { workTimeZone: workTimeZone || null }) });
    return null;
  },
);

/** What Settings → Google shows of the OAuth client: the ID, and only whether a secret is there. */
const clientView = async () => {
  const { id, idState, secretState } = await loadGoogleClientConfig();
  return { id, idState, secretState };
};

/**
 * Saves the OAuth client in Settings → Google: the ID as typed (empty
 * removes it), the secret encrypted, or removed. The secret never comes
 * back to the browser. A different client ID can't use the old grant, so
 * changing it disconnects the account.
 */
export const saveGoogleClient = action(
  z.strictObject({
    id: z.string().trim().max(300).optional(),
    secret: z
      .discriminatedUnion("action", [z.object({ action: z.literal("set"), value: z.string().trim().min(1).max(500) }), z.object({ action: z.literal("clear") })])
      .optional(),
  }),
  async ({ id, secret }) => {
    const current = await loadSettings();
    const before = await loadGoogleClientConfig();
    await saveSettings({
      ...(id === undefined ? {} : { googleClientId: id || null }),
      ...(secret === undefined ? {} : { googleClientSecretEnc: applySecretChange(GOOGLE_CLIENT_SECRET, current.googleClientSecretEnc, secret) }),
    });
    // Google's grant belongs to the client ID; a new secret for the same client keeps it.
    if (before.id && before.id !== (await loadGoogleClientConfig()).id) await disconnectGoogle().catch(() => {});
    revalidatePath("/settings");
    return clientView();
  },
);

/** "Disconnect": revokes Dossier's access at Google. */
export const disconnectGoogleAccount = action(z.object({}), async (_, { toast }) => {
  await google(disconnectGoogle);
  revalidatePath("/settings");
  toast("Disconnected from Google.");
  return null;
});

/** "Send with Gmail" on the Email tab, after the confirmation. */
export const sendWithGmail = action(z.object({ id: z.string().min(1) }), async ({ id }, { toast }) => {
  const sent = await google(() => sendApplicationEmail(id));
  refreshEverything();
  toast(sent.eventId ? `Sent. ${statusInfo(ApplicationStatus.SENT).toast}` : "Sent.");
  return { eventId: sent.eventId };
});
