import "server-only";

import { googleFetch } from "./account";
import { googleUrl } from "./endpoints";
import { buildMessage, toBase64Url, type OutgoingMail } from "./mime";

// Sending through the Gmail API (E15-2). Sending never asks again, so nothing goes twice.

const api = (path: string) => googleUrl("gmail", `/gmail/v1/users/me${path}`);

/** Sends a message from the connected account. */
export async function sendMail(mail: OutgoingMail): Promise<{ id: string; threadId: string }> {
  const sent = await googleFetch<{ id: string; threadId: string }>("send", api("/messages/send"), {
    method: "POST",
    body: { raw: toBase64Url(buildMessage(mail)) },
  });
  return { id: sent.id, threadId: sent.threadId };
}
