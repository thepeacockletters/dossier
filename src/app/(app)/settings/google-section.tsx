"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { useTrackSave } from "@/components/save-tracker";
import { toast, toastResult } from "@/components/toast";
import { Button, buttonClassName } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { disconnectGoogleAccount, saveGoogleClient, saveGoogleSettings } from "@/lib/google/actions";
import { cn } from "@/lib/cn";

import { SettingsSectionIntro } from "./settings-screen";

export type GoogleSettings = {
  calendarEvents: boolean;
  calendarId: string;
  workTimeZone: string | null;
  slotMinutes: number;
};

/** Where each part of the OAuth client comes from; the secret itself never reaches the browser. */
export type GoogleClientView = {
  id: string;
  idState: "set" | "env" | "none" | "unreadable";
  secretState: "set" | "env" | "none" | "unreadable";
};

export type GoogleConnectionView =
  | { status: "not-configured" }
  | { status: "disconnected" }
  | {
      status: "connected";
      email: string;
      canSend: boolean;
      canUseCalendar: boolean;
      signInProblem: string | null;
    };

const LENGTHS = [15, 30, 45, 60, 90];

/** What came back from Google's consent page, as a message. */
export const CALLBACK_MESSAGES: Record<string, string> = {
  connected: "Connected to Google.",
  denied: "Google wasn't given access, so nothing changed.",
  expired: "That took too long or didn't start here. Try connecting again.",
  rejected: "Google refused the sign-in. Check the client ID and secret below.",
  failed: "Connecting to Google didn't work. Try again.",
  "not-configured": "Google isn't set up on this server yet. See the steps below.",
};

/**
 * Settings → Google (E15-1): connect Gmail and Calendar, and choose how
 * interviews go into the calendar. Every field saves on its own. Nothing is ever sent without asking.
 */
export function GoogleSection({
  connection,
  client,
  initial,
  browserTimeZone,
  redirectUri,
}: {
  connection: GoogleConnectionView;
  client: GoogleClientView;
  initial: GoogleSettings;
  browserTimeZone: string | null;
  /** The address to register in Google Cloud. */
  redirectUri: string;
}) {
  const track = useTrackSave();
  const router = useRouter();
  const [settings, setSettings] = useState(initial);
  const [timeZone, setTimeZone] = useState(initial.workTimeZone ?? "");
  const [calendarId, setCalendarId] = useState(initial.calendarId);
  const [confirming, setConfirming] = useState(false);

  const change = (next: Partial<GoogleSettings>) => {
    const previous = settings;
    setSettings({ ...settings, ...next });
    void track(saveGoogleSettings(next as Parameters<typeof saveGoogleSettings>[0])).then((result) => {
      if (!toastResult(result).ok) setSettings(previous);
    });
  };

  const disconnect = async () => {
    if (toastResult(await disconnectGoogleAccount({})).ok) router.refresh();
  };

  if (connection.status === "not-configured") return <SetupSteps redirectUri={redirectUri} client={client} />;

  return (
    <>
      <SettingsSectionIntro title="Google">
        Send applications from your Gmail and keep interviews in your calendar. Dossier always asks before it sends anything.
      </SettingsSectionIntro>

      <Card className="flex flex-col gap-4">
        {connection.status === "connected" ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p role="status" className="flex items-center gap-2 text-control">
                <span aria-hidden className="size-2 flex-none rounded-full bg-success" />
                Connected as <span className="font-medium">{connection.email}</span>
              </p>
              <Button variant="danger-outline" size="sm" onClick={() => setConfirming(true)}>
                Disconnect
              </Button>
            </div>
            {connection.signInProblem && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line px-4 py-3">
                <p role="alert" className="text-control text-error">
                  {connection.signInProblem} Until then, Dossier doesn&apos;t send mail or check your calendar.
                </p>
                <a href="/api/google/connect" className={buttonClassName("secondary", "sm")}>
                  Connect again
                </a>
              </div>
            )}
            <ul className="flex flex-col gap-1.5 text-meta text-muted">
              <Permission granted={connection.canSend} group="send" label="Send email from your address" />
              <Permission granted={connection.canUseCalendar} group="calendar" label="Add interviews to your calendar" />
            </ul>
          </>
        ) : (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-muted">
              You&apos;ll sign in on Google&apos;s own page and choose what Dossier may do. Tokens are stored encrypted on your server and
              never leave it, except to talk to Google.
            </p>
            <a href="/api/google/connect" className={buttonClassName("primary", "md", "hover:text-on-primary")}>
              Connect Google account
            </a>
          </div>
        )}
      </Card>

      {connection.status === "connected" && (
        <>
          <Card padding="none" className="flex flex-col px-7 pt-1.5 pb-6">
            <Toggle
              className="py-4"
              label="Add interviews to my calendar"
              description="Add an application's interview with a link back to it, and keep it in step: a time changed here or in Google changes on both sides."
              checked={settings.calendarEvents}
              disabled={!connection.canUseCalendar}
              onCheckedChange={(calendarEvents) => change({ calendarEvents })}
            />
            <div className="grid gap-x-[18px] gap-y-5 border-t border-line pt-5 sm:grid-cols-2">
              <Select label="Interview length" value={settings.slotMinutes} onChange={(event) => change({ slotMinutes: Number(event.target.value) })}>
                {LENGTHS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </Select>
              <Input
                label="Time zone"
                placeholder={browserTimeZone ?? "Europe/Berlin"}
                hint={browserTimeZone ? `Empty uses your browser's: ${browserTimeZone}` : "Empty uses your browser's"}
                value={timeZone}
                spellCheck={false}
                onChange={(event) => setTimeZone(event.target.value)}
                onBlur={() => timeZone.trim() !== (settings.workTimeZone ?? "") && change({ workTimeZone: timeZone.trim() || null })}
              />
              <Input
                label="Calendar"
                hint="primary is your main calendar; or a calendar's ID from Google Calendar's settings"
                value={calendarId}
                spellCheck={false}
                onChange={(event) => setCalendarId(event.target.value)}
                onBlur={() => calendarId.trim() && calendarId.trim() !== settings.calendarId && change({ calendarId: calendarId.trim() })}
              />
            </div>
          </Card>
        </>
      )}

      <ClientCard initial={client} connected={connection.status === "connected"} />

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Disconnect Google?"
        description="Dossier's access is revoked at Google. You can connect again at any time."
        confirmLabel="Disconnect"
        onConfirm={() => void disconnect()}
      />
    </>
  );
}

/** A permission and, while it's missing, the link to allow it. */
function Permission({ granted, group, label }: { granted: boolean; group: string; label: string }) {
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span aria-hidden className={cn("size-1.5 flex-none rounded-full", granted ? "bg-success" : "bg-faint")} />
      <span className={cn(granted && "text-ink")}>{label}</span>
      {!granted && (
        <a href={`/api/google/connect?scopes=${group}`} className="underline underline-offset-3">
          Allow
        </a>
      )}
      <span className="sr-only">{granted ? "(allowed)" : "(not allowed)"}</span>
    </li>
  );
}

/** Before the server has a Google client: how to make one. */
function SetupSteps({ redirectUri, client }: { redirectUri: string; client: GoogleClientView }) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      toast("Copied the redirect URI.");
    } catch {
      toast("That didn't copy. Select it and copy it yourself.");
    }
  };
  return (
    <>
      <SettingsSectionIntro title="Google">
        Connect Gmail and Google Calendar to send applications and keep interviews in your calendar. First, give this server a Google
        OAuth client.
      </SettingsSectionIntro>
      <Card className="flex flex-col gap-4 text-sm">
        <ol className="flex list-decimal flex-col gap-2.5 pl-5">
          <li>
            In <span className="font-medium">Google Cloud Console</span>, create a project and enable the{" "}
            <span className="font-medium">Gmail API</span> and the <span className="font-medium">Google Calendar API</span>.
          </li>
          <li>
            Set up the <span className="font-medium">OAuth consent screen</span> as External, add yourself as a test user, then{" "}
            <span className="font-medium">publish</span> it (In production). Unpublished, Google stops the access after 7 days.
          </li>
          <li>
            Create an <span className="font-medium">OAuth client ID</span> of type Web application, with this authorised redirect URI:
            <span className="mt-1.5 flex items-center gap-2">
              <code className="rounded-control border border-line-field bg-input px-2 py-1 font-mono text-label [overflow-wrap:anywhere]">
                {redirectUri}
              </code>
              <Button variant="text" size="sm" onClick={() => void copy()}>
                Copy
              </Button>
            </span>
          </li>
          <li>Paste the client&apos;s ID and secret below.</li>
        </ol>
      </Card>
      <ClientCard initial={client} connected={false} />
    </>
  );
}

const SECRET_PLACEHOLDER: Record<GoogleClientView["secretState"], string> = {
  set: "Saved · type a new secret to replace it",
  env: "Using DOSSIER_GOOGLE_CLIENT_SECRET · type one to save it here",
  none: "Stored encrypted on your server",
  unreadable: "Stored encrypted on your server",
};

/**
 * The OAuth client: its ID, and a write-only secret, each saved when you
 * leave its field. Saved here, they override the DOSSIER_GOOGLE_CLIENT_*
 * variables. A different client ID disconnects the account.
 */
export function ClientCard({ initial, connected }: { initial: GoogleClientView; connected: boolean }) {
  const track = useTrackSave();
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [id, setId] = useState(initial.id);
  const [secret, setSecret] = useState("");

  const save = async (change: Parameters<typeof saveGoogleClient>[0]) => {
    const result = toastResult(await track(saveGoogleClient(change)));
    if (!result.ok) return false;
    setView(result.data);
    setId(result.data.id);
    router.refresh();
    return true;
  };

  const saveId = () => {
    if (id.trim() === view.id) return;
    void save({ id });
  };
  const saveSecret = async () => {
    if (!secret.trim()) return;
    if (await save({ secret: { action: "set", value: secret } })) setSecret("");
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h3 className="text-control font-medium">OAuth client</h3>
        <p className="text-meta text-muted">
          {connected ? "Changing the client ID disconnects your Google account; connect again afterwards." : "Saved on this server, so no restart is needed."}
        </p>
      </div>
      <div className="grid grid-cols-1 gap-x-[18px] gap-y-5 sm:grid-cols-2">
        <Input
          label="Client ID"
          value={id}
          placeholder={view.idState === "env" ? "Using DOSSIER_GOOGLE_CLIENT_ID" : "…apps.googleusercontent.com"}
          hint={view.idState === "env" ? "From DOSSIER_GOOGLE_CLIENT_ID · type one to save it here" : undefined}
          spellCheck={false}
          autoComplete="off"
          inputClassName="font-mono text-[13.5px]"
          onChange={(event) => setId(event.target.value)}
          onBlur={saveId}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              saveId();
            }
          }}
        />
        <div className="flex flex-col gap-2.5">
          <Input
            label="Client secret"
            type="password"
            autoComplete="off"
            value={secret}
            placeholder={SECRET_PLACEHOLDER[view.secretState]}
            error={view.secretState === "unreadable" ? "The saved secret can't be read, probably since DOSSIER_SECRET changed. Enter it again." : undefined}
            onChange={(event) => setSecret(event.target.value)}
            onBlur={() => void saveSecret()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && secret.trim()) {
                event.preventDefault();
                void saveSecret();
              }
            }}
          />
          {(view.secretState === "set" || view.secretState === "unreadable") && (
            <Button variant="text" size="sm" className="self-start" onClick={() => void save({ secret: { action: "clear" } })}>
              Remove saved secret
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
