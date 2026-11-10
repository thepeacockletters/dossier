
// Google's addresses.

const HOSTS = {
  accounts: "https://accounts.google.com",
  oauth2: "https://oauth2.googleapis.com",
  gmail: "https://gmail.googleapis.com",
  www: "https://www.googleapis.com",
} as const;

/** `path` on one of Google's hosts, e.g. googleUrl("oauth2", "/token"). */
export function googleUrl(host: keyof typeof HOSTS, path: string): string {
  return `${HOSTS[host]}${path}`;
}
