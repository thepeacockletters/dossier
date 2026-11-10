import { randomBytes } from "node:crypto";

// Building email messages (RFC 5322, MIME) for Gmail (E15-2). Only what
// Dossier sends: a plain text body with PDF attachments.

export type Attachment = { fileName: string; contentType: string; data: Uint8Array };

export type OutgoingMail = {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments?: Attachment[];
};

/** A header value in RFC 2047 encoded words when it isn't plain ASCII. */
export function encodeHeader(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  if (/^[\x20-\x7e]*$/.test(clean)) return clean;
  return `=?UTF-8?B?${Buffer.from(clean, "utf8").toString("base64")}?=`;
}

/** "Jane Doe <jane@example.com>", the name maybe in quotes, in its parts; null for an address alone. */
function addressParts(value: string): { name: string; address: string } | null {
  const match = /^([^<]*)<([^<>]+)>\s*$/.exec(value);
  if (!match) return null;
  return { name: match[1].trim().replace(/^"|"$/g, "").trim(), address: match[2].trim() };
}

/** "Name <a@b>" with the name encoded, or the address alone. */
export function encodeAddress(value: string): string {
  const clean = value.replace(/[\r\n]+/g, " ");
  const parts = addressParts(clean);
  if (!parts) return clean.trim();
  return parts.name ? `${encodeHeader(parts.name)} <${parts.address}>` : parts.address;
}

/** Base64 in lines of 76, as MIME wants. */
function wrapped(data: Uint8Array | string): string {
  const base64 = Buffer.from(data).toString("base64");
  return base64.replace(/.{1,76}/g, "$&\r\n").trimEnd();
}

/** A file name for Content-Disposition (RFC 2231 for anything not ASCII). */
function fileNameParameter(name: string): string {
  const safe = name.replace(/["\\\r\n]/g, "_");
  if (/^[\x20-\x7e]*$/.test(safe)) return `filename="${safe}"`;
  return `filename="${safe.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** The whole message, ready for Gmail's `raw` field after base64url. */
export function buildMessage(mail: OutgoingMail, { boundary = `dossier-${randomBytes(12).toString("hex")}`, date = new Date() } = {}): string {
  const headers = [
    `From: ${encodeAddress(mail.from)}`,
    `To: ${mail.to.split(/[,;]/).map(encodeAddress).filter(Boolean).join(", ")}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    "MIME-Version: 1.0",
  ];
  const text = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapped(mail.body.replace(/\r?\n/g, "\r\n"))].join("\r\n");
  const attachments = mail.attachments ?? [];
  if (attachments.length === 0) return [...headers, text].join("\r\n");

  const parts = [
    text,
    ...attachments.map((file) =>
      [
        `Content-Type: ${file.contentType}; name="${file.fileName.replace(/["\\\r\n]/g, "_")}"`,
        `Content-Disposition: attachment; ${fileNameParameter(file.fileName)}`,
        "Content-Transfer-Encoding: base64",
        "",
        wrapped(file.data),
      ].join("\r\n"),
    ),
  ];
  return [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    ...parts.map((part) => `--${boundary}\r\n${part}`),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

/** base64url, as Gmail's API wants message bodies. */
export const toBase64Url = (text: string) => Buffer.from(text, "utf8").toString("base64url");
