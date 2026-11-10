import { describe, expect, it } from "vitest";

import { buildMessage, encodeAddress, encodeHeader } from "./mime";

const decodeBody = (message: string) => {
  const [, ...rest] = message.split("\r\n\r\n");
  return Buffer.from(rest.join("\r\n\r\n").replace(/\r\n/g, ""), "base64").toString("utf8");
};

describe("buildMessage", () => {
  it("writes a plain text mail with encoded headers", () => {
    const message = buildMessage(
      { from: "Jane Doe <jane@gmail.com>", to: "Anna Müller <anna@ledgerly.example>", subject: "Bewerbung: Designerin", body: "Hallo,\nanbei." },
      { date: new Date("2026-10-18T10:00:00Z") },
    );
    expect(message).toContain("From: Jane Doe <jane@gmail.com>");
    expect(message).toContain(`To: =?UTF-8?B?${Buffer.from("Anna Müller").toString("base64")}?= <anna@ledgerly.example>`);
    expect(message).toContain("Subject: Bewerbung: Designerin");
    expect(message).toContain("Date: Sun, 18 Oct 2026 10:00:00 +0000");
    expect(message).not.toContain("multipart");
    expect(decodeBody(message)).toBe("Hallo,\r\nanbei.");
  });

  it("attaches files in a multipart message", () => {
    const message = buildMessage(
      { from: "jane@gmail.com", to: "jobs@ledgerly.example", subject: "Application", body: "Hi", attachments: [{ fileName: "Jane – Resume.pdf", contentType: "application/pdf", data: new Uint8Array([37, 80, 68, 70]) }] },
      { boundary: "b1" },
    );
    expect(message).toContain('Content-Type: multipart/mixed; boundary="b1"');
    expect(message).toContain("--b1\r\nContent-Type: text/plain; charset=UTF-8");
    expect(message).toContain(`filename*=UTF-8''${encodeURIComponent("Jane – Resume.pdf")}`);
    expect(message).toContain(Buffer.from("%PDF").toString("base64"));
    expect(message.trimEnd().endsWith("--b1--")).toBe(true);
  });

  it("never lets a header carry a line break", () => {
    expect(encodeHeader("Hi\r\nBcc: x@y.z")).toBe("Hi Bcc: x@y.z");
    expect(encodeAddress("x@y.z\r\nBcc: a@b.c")).toBe("x@y.z Bcc: a@b.c");
    expect(encodeAddress("Jane <x@y.z\r\nBcc: a@b.c>")).toBe("Jane <x@y.z Bcc: a@b.c>");
  });
});

