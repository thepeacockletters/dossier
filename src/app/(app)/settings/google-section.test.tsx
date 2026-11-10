import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { disconnectGoogleAccount, saveGoogleSettings } from "@/lib/google/actions";

import { GoogleSection, type GoogleClientView, type GoogleSettings } from "./google-section";

vi.mock("@/lib/google/actions", () => ({
  saveGoogleClient: vi.fn(async () => ({ ok: true, data: { id: "", idState: "none", secretState: "none" } })),
  disconnectGoogleAccount: vi.fn(async () => ({ ok: true, data: null })),
  saveGoogleSettings: vi.fn(async () => ({ ok: true, data: null })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ toast: vi.fn(), toastResult: (result: unknown) => result }));

const settings: GoogleSettings = { calendarEvents: true, calendarId: "primary", workTimeZone: null, slotMinutes: 45 };
const redirect = "http://localhost:3000/api/google/callback";
const client: GoogleClientView = { id: "", idState: "none", secretState: "none" };

beforeEach(() => vi.mocked(saveGoogleSettings).mockClear());

describe("GoogleSection (E15-1)", () => {
  it("explains the setup while the server has no Google client", () => {
    render(<GoogleSection client={client} connection={{ status: "not-configured" }} initial={settings} browserTimeZone="Europe/Berlin" redirectUri={redirect} />);
    expect(screen.getByText(redirect)).toBeInTheDocument();
    expect(screen.getByLabelText("Client ID")).toBeInTheDocument();
    expect(screen.getByLabelText("Client secret")).toHaveAttribute("type", "password");
  });

  it("offers to connect", () => {
    render(<GoogleSection client={client} connection={{ status: "disconnected" }} initial={settings} browserTimeZone={null} redirectUri={redirect} />);
    expect(screen.getByRole("link", { name: "Connect Google account" })).toHaveAttribute("href", "/api/google/connect");
  });

  it("asks to connect again once Google refuses the saved access (#136)", () => {
    const problem = "Google no longer accepts Dossier's access. Connect your Google account again.";
    render(
      <GoogleSection
        client={client}
        connection={{ status: "connected", email: "jane@gmail.com", canSend: true, canUseCalendar: true, signInProblem: problem }}
        initial={settings}
        browserTimeZone={null}
        redirectUri={redirect}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Until then, Dossier doesn't send mail or check your calendar.");
    expect(screen.getByRole("link", { name: "Connect again" })).toHaveAttribute("href", "/api/google/connect");
  });

  it("saves each choice, links to missing permissions, and disconnects after asking", async () => {
    const user = userEvent.setup();
    render(
      <GoogleSection
        client={client}
        connection={{ status: "connected", email: "jane@gmail.com", canSend: true, canUseCalendar: false, signInProblem: null }}
        initial={settings}
        browserTimeZone="Europe/Berlin"
        redirectUri={redirect}
      />,
    );
    expect(screen.getByText("jane@gmail.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Allow" })).toHaveAttribute("href", "/api/google/connect?scopes=calendar");

    await user.selectOptions(screen.getByRole("combobox", { name: "Interview length" }), "60");
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ slotMinutes: 60 });
    await user.type(screen.getByRole("textbox", { name: "Time zone" }), "America/New_York");
    await user.tab();
    expect(saveGoogleSettings).toHaveBeenLastCalledWith({ workTimeZone: "America/New_York" });

    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    await user.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(disconnectGoogleAccount).toHaveBeenCalled();
  });
});
