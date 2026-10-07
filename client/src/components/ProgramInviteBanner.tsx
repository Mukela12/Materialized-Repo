/**
 * On the dashboard of an account switched on for program invites: how many
 * invites are left, and the way in. The sidebar has the page too, but phones
 * have no sidebar, and producers mostly work from their phones.
 */
import { Link } from "wouter";
import { ArrowRight, Send } from "lucide-react";
import { useProgram, programInvitesPath } from "@/hooks/useProgram";
import { useCurrentUser } from "@/hooks/useCurrentUser";

export function ProgramInviteBanner() {
  const { data: program } = useProgram();
  const { data: user } = useCurrentUser();
  if (!program?.enabled || !program.seats) return null;
  const left = program.seats.brand.remaining + program.seats.creator.remaining;
  return (
    <Link
      href={programInvitesPath(user?.role)}
      className="group flex items-center gap-3 rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50"
      data-testid="program-invite-banner"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Send className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">Invite your network</span>
        <span className="block truncate text-sm text-muted-foreground">
          {program.programName}: {left} free invite{left === 1 ? "" : "s"} left for your designers and influencers
        </span>
      </span>
      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
