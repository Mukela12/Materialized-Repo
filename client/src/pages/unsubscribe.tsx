/**
 * Unsubscribe from the onboarding emails (server/journeys.ts), from the link
 * at the foot of each one. Asks before acting: mail scanners open every link
 * in a message, and a page that unsubscribed on load would unsubscribe people
 * who never clicked. One-click unsubscribe from the mail client itself posts
 * straight to the API instead.
 */
import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";

export default function Unsubscribe() {
  const { token } = useParams<{ token: string }>();
  const [optedOut, setOptedOut] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data, isLoading, isError } = useQuery<{ email: string; optedOut: boolean }>({
    queryKey: ["/api/email/preferences", token],
    queryFn: async () => {
      const r = await fetch(`/api/email/preferences/${encodeURIComponent(token)}`);
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    },
    retry: false,
  });
  const out = optedOut ?? data?.optedOut ?? false;

  async function change(unsubscribe: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/email/${unsubscribe ? "unsubscribe" : "resubscribe"}/${encodeURIComponent(token)}`, { method: "POST" });
      if (!r.ok) throw new Error();
      setOptedOut(unsubscribe);
    } catch {
      setError("That didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#202120] px-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <img src={materializedLogo} alt="MTRLZD" style={{ height: 40, width: "auto" }} />
        </div>
        <div className="bg-card border border-border rounded-2xl p-8 shadow-xl text-center" data-testid="unsubscribe-card">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">One moment…</p>
          ) : isError || !data ? (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-2">This link has expired</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Use the unsubscribe link in your most recent email from us, or reply to it and we'll take you off the list.
              </p>
              <Link href="/"><Button variant="outline" className="w-full">Go to MTRLZD</Button></Link>
            </>
          ) : out ? (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-2">You're unsubscribed</h1>
              <p className="text-sm text-muted-foreground mb-6">
                {data.email} won't get any more tips or reminders from us. Emails about your account, like password
                resets and payments, still arrive.
              </p>
              <Button variant="outline" className="w-full" disabled={busy} onClick={() => change(false)} data-testid="button-resubscribe">
                Subscribe again
              </Button>
            </>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground mb-2">Unsubscribe?</h1>
              <p className="text-sm text-muted-foreground mb-6">
                Stop tips and reminders from MTRLZD to {data.email}. Emails about your account, like password resets and
                payments, will still arrive.
              </p>
              <Button className="w-full" disabled={busy} onClick={() => change(true)} data-testid="button-unsubscribe">
                Unsubscribe
              </Button>
            </>
          )}
          {error && <p className="text-sm text-destructive mt-3">{error}</p>}
        </div>
      </div>
    </div>
  );
}
