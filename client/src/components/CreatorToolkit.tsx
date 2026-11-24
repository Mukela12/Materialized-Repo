/**
 * The Creator Toolkit on the creator homepage (client, 18 Nov 2026): up to two
 * partner tool cards (an explainer video, a voucher code, a tracked sign-up
 * link), the monthly Creator Challenge, and a full-width Creator Film Awards
 * banner with registration. Admin edits the content in Admin > Homepage.
 *
 * The cards are "backlit": a solid surface with a soft shadow in the card's
 * own colour that brightens and lifts on hover. No gradients.
 *
 * 24 Nov 2026: each card can carry an image with a short line that rises over
 * it on hover (always visible where there is no hover, so phones see it), and
 * an announcement bar with running text can sit above the cards.
 */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check, Copy, Film, Megaphone, Play, Trophy } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient, serverMessage } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";
import { TONES } from "@/components/CreatorDashboard";
import type { Announcement, AwardsBanner, ChallengeCard, ToolCard } from "@shared/creatorToolkit";

export interface ToolkitView {
  tools: (ToolCard & { slot: number })[];
  challenge: ChallengeCard;
  awards: AwardsBanner;
  announcement?: Announcement | null;
  status: { month: string; open: boolean; opensAt: string; closesAt: string; announceAt: string };
  myEntries: { id: string; title: string }[];
  registeredHandle: string | null;
}

type Tone = (typeof TONES)[number];

/** The backlit surface shared by every card here. */
function glow(tone: Tone) {
  return {
    style: { ["--tl" as string]: tone.l, ["--td" as string]: tone.d },
    className: cn(
      "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border bg-card",
      "shadow-[0_14px_32px_-18px_color-mix(in_srgb,var(--tl)_70%,transparent)]",
      "transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
      "hover:-translate-y-1 hover:border-[color:color-mix(in_srgb,var(--tl)_45%,hsl(var(--border)))]",
      "hover:shadow-[0_22px_44px_-18px_color-mix(in_srgb,var(--tl)_85%,transparent)]",
      "dark:shadow-[0_14px_32px_-18px_color-mix(in_srgb,var(--td)_60%,transparent)]",
      "dark:hover:shadow-[0_22px_44px_-18px_color-mix(in_srgb,var(--td)_75%,transparent)]",
      "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
    ),
  };
}

/** The 1st of the month after the one `opensAt` starts. */
const nextRound = (opensAt: string) => {
  const d = new Date(opensAt);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();
};

const dayMonth = (iso: string, endExclusive = false) =>
  new Date(new Date(iso).getTime() - (endExclusive ? 1 : 0)).toLocaleDateString(undefined, { day: "numeric", month: "long", timeZone: "UTC" });

/**
 * The short line over a card image. Where the device can hover it rises in
 * when the card is hovered or focused; on touch screens it is simply there.
 * A solid scrim, not a gradient, keeps the text readable on any image.
 */
function HoverCaption({ text, hidden }: { text: string; hidden?: boolean }) {
  if (!text || hidden) return null;
  return (
    <p
      className={cn(
        "pointer-events-none absolute inset-x-0 bottom-0 bg-black/70 px-3 py-2 text-[13px] font-medium leading-snug text-white",
        "transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none",
        "[@media(hover:hover)]:translate-y-1 [@media(hover:hover)]:opacity-0",
        "[@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100",
        "[@media(hover:hover)]:group-focus-within:translate-y-0 [@media(hover:hover)]:group-focus-within:opacity-100",
      )}
      data-testid="text-card-hover"
    >
      {text}
    </p>
  );
}

/** A card's cover image with its hover line. */
function CardImage({ src, caption }: { src: string; caption: string }) {
  if (!src) return null;
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-muted">
      <img src={src} alt="" className="h-full w-full object-cover transition-transform duration-500 ease-out group-hover:scale-[1.03] motion-reduce:transition-none motion-reduce:group-hover:scale-100" loading="lazy" />
      <HoverCaption text={caption} />
    </div>
  );
}

/** A video that plays inline when tapped, with the poster (or a quiet panel) before. */
function ExplainerVideo({ src, poster, label, caption = "" }: { src: string; poster: string; label: string; caption?: string }) {
  const [playing, setPlaying] = useState(false);
  if (!src) return <CardImage src={poster} caption={caption} />;
  return (
    <div className="relative aspect-video w-full bg-black">
      {playing ? (
        <video src={src} poster={poster || undefined} className="h-full w-full object-cover" controls autoPlay playsInline />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          className="group/play absolute inset-0 flex items-center justify-center"
          aria-label={`Play the video about ${label}`}
        >
          {poster ? <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
            : <video src={`${src}#t=0.5`} className="absolute inset-0 h-full w-full object-cover" muted playsInline preload="metadata" />}
          <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/90 text-black shadow-lg transition-transform duration-200 group-hover/play:scale-105 group-active/play:scale-[0.97]">
            <Play className="ml-0.5 h-5 w-5 fill-current" aria-hidden="true" />
          </span>
        </button>
      )}
      <HoverCaption text={caption} hidden={playing} />
    </div>
  );
}

function VoucherCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    // Only says Copied when it was; otherwise the code is still on screen to copy by hand.
    if (await copyText(code)) { setCopied(true); setTimeout(() => setCopied(false), 1600); }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex w-full items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 text-left transition-colors hover:bg-muted/50"
      data-testid="button-copy-voucher"
    >
      <span className="min-w-0">
        <span className="block text-[11px] text-muted-foreground">Voucher code</span>
        <span className="block truncate font-mono text-sm font-semibold tracking-wide">{code}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
        {copied ? <><Check className="h-3.5 w-3.5" aria-hidden="true" />Copied</> : <><Copy className="h-3.5 w-3.5" aria-hidden="true" />Copy</>}
      </span>
    </button>
  );
}

function ToolCardView({ tool, tone }: { tool: ToolkitView["tools"][number]; tone: Tone }) {
  const g = glow(tone);
  return (
    <article {...g} data-testid={`card-toolkit-tool-${tool.slot}`}>
      <ExplainerVideo src={tool.videoUrl} poster={tool.posterUrl} label={tool.name} caption={tool.hoverText} />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--tl)] dark:text-[color:var(--td)]">Creator tool</p>
          <h3 className="mt-1 text-base font-semibold tracking-tight">{tool.name}</h3>
          {tool.tagline && <p className="mt-1 text-sm text-muted-foreground">{tool.tagline}</p>}
        </div>
        <div className="mt-auto space-y-2">
          {tool.voucherCode && <VoucherCode code={tool.voucherCode} />}
          <Button asChild className="w-full rounded-full">
            <a href={`/api/toolkit/go/${tool.slot}`} target="_blank" rel="noopener noreferrer" data-testid={`link-toolkit-tool-${tool.slot}`}>
              {tool.ctaLabel || "Sign up"}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
        </div>
      </div>
    </article>
  );
}

function ChallengeCardView({ data, tone, onEnter }: { data: ToolkitView; tone: Tone; onEnter: () => void }) {
  const g = glow(tone);
  const { challenge: c, status } = data;
  const entered = data.myEntries.length > 0;
  return (
    <article {...g} data-testid="card-toolkit-challenge">
      <CardImage src={c.imageUrl} caption={c.hoverText} />
      <div className="flex flex-1 flex-col gap-3 p-4 md:p-5">
        <div className="flex items-center gap-2 text-[color:var(--tl)] dark:text-[color:var(--td)]">
          <Trophy className="h-4 w-4" aria-hidden="true" />
          <p className="text-[11px] font-medium uppercase tracking-[0.12em]">{c.title} this month</p>
        </div>
        <p className="text-[clamp(2rem,6vw,2.75rem)] font-semibold leading-none tracking-[-0.03em] tabular-nums text-[color:var(--tl)] dark:text-[color:var(--td)]" data-testid="text-challenge-prize">
          {c.prize}
        </p>
        <p className="text-sm text-muted-foreground">{c.body}</p>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg bg-muted/60 px-2.5 py-2">
            <dt className="text-muted-foreground">Entries</dt>
            <dd className="mt-0.5 font-medium">{status.open ? `Open until ${dayMonth(status.closesAt, true)}` : `Next round opens ${dayMonth(nextRound(status.opensAt))}`}</dd>
          </div>
          <div className="rounded-lg bg-muted/60 px-2.5 py-2">
            <dt className="text-muted-foreground">Winner</dt>
            <dd className="mt-0.5 font-medium">{dayMonth(status.announceAt)}</dd>
          </div>
        </dl>
        <div className="mt-auto">
          {entered ? (
            <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" data-testid="text-challenge-entered">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="min-w-0">You entered <span className="font-medium">{data.myEntries[0].title}</span>{data.myEntries.length > 1 ? ` and ${data.myEntries.length - 1} more` : ""}. Share it to climb the board.</span>
            </p>
          ) : status.open ? (
            <Button className="w-full rounded-full" onClick={onEnter} data-testid="button-enter-challenge">Upload your entry</Button>
          ) : (
            <p className="text-xs text-muted-foreground">This round's entries closed on {dayMonth(status.closesAt, true)}. Upload now and enter from the 1st.</p>
          )}
        </div>
      </div>
    </article>
  );
}

function AwardsBannerView({ awards, registeredHandle, email }: { awards: AwardsBanner; registeredHandle: string | null; email: string }) {
  const tone = TONES[3];
  const g = glow(tone);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email, handle: "" });
  const register = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/film-awards/register", form)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/toolkit"] });
      setOpen(false);
      toast({ title: "You're registered", description: "We'll email you as entries and invitations open." });
    },
    onError: (err: unknown) => toast({ title: "Not registered", description: serverMessage(err) || "Check your email and handle.", variant: "destructive" }),
  });
  return (
    <article {...g} className={cn(g.className, "md:flex-row")} data-testid="banner-film-awards">
      {/* The film plays muted on a loop; with no video or image yet the
          banner is text only rather than an empty frame. */}
      {(awards.videoUrl || awards.posterUrl) && (
        <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-950 md:aspect-auto md:min-h-[260px] md:w-[46%]">
          {awards.videoUrl ? (
            <video src={awards.videoUrl} poster={awards.posterUrl || undefined} className="absolute inset-0 h-full w-full object-cover" autoPlay muted loop playsInline aria-hidden="true" />
          ) : (
            <img src={awards.posterUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-4 p-5 md:p-7">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-[color:var(--tl)] dark:text-[color:var(--td)]"><Film className="h-3.5 w-3.5" aria-hidden="true" />{awards.place}</p>
          <h3 className="mt-1.5 text-2xl font-semibold tracking-[-0.02em] md:text-3xl">{awards.title}</h3>
          <p className="mt-1 text-sm font-medium text-muted-foreground">{awards.dates}</p>
        </div>
        {awards.highlights.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {awards.highlights.map((h) => (
              <li key={h} className="rounded-full border px-2.5 py-1 text-xs font-medium">{h}</li>
            ))}
          </ul>
        )}
        <div className="mt-auto">
          {registeredHandle ? (
            <p className="flex items-center gap-2 text-sm" data-testid="text-awards-registered">
              <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              Registered as <span className="font-medium">{registeredHandle}</span>
            </p>
          ) : open ? (
            <form
              className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"
              onSubmit={(e) => { e.preventDefault(); register.mutate(); }}
              data-testid="form-awards-register"
            >
              <Input type="email" required autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email" aria-label="Email" className="text-base sm:text-sm" />
              <Input required value={form.handle} onChange={(e) => setForm({ ...form, handle: e.target.value })} placeholder="@yourhandle" aria-label="Your handle" className="text-base sm:text-sm" data-testid="input-awards-handle" />
              <Button type="submit" className="rounded-full" disabled={register.isPending} data-testid="button-awards-submit">
                {register.isPending ? "Registering…" : "Register"}
              </Button>
            </form>
          ) : (
            <Button className="rounded-full" onClick={() => setOpen(true)} data-testid="button-awards-register">Register now</Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The announcement bar above the cards. Running text loops copies of the
 * line and pauses while hovered; with reduced motion, or with scrolling off,
 * the line simply wraps.
 */
export function AnnouncementBar({ a }: { a: Announcement }) {
  const moving = a.scroll;
  const line = (hiddenCopy = false) => (
    <span className="flex shrink-0 items-center gap-3 pr-12" aria-hidden={hiddenCopy || undefined}>
      <span className="text-sm font-medium">{a.text}</span>
      {a.linkUrl && <ArrowUpRight className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden="true" />}
    </span>
  );
  const body = (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-foreground/15">
        <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      {moving ? (
        <div className="mz-ticker min-w-0 flex-1 overflow-hidden">
          {/* Each half holds three copies so a short line still fills a wide bar; the loop moves one half. */}
          <div className="mz-ticker-track">{line()}{line(true)}{line(true)}{line(true)}{line(true)}{line(true)}</div>
          <span className="mz-ticker-still text-sm font-medium">{a.text}</span>
        </div>
      ) : (
        <span className="min-w-0 flex-1 text-sm font-medium">{a.text}</span>
      )}
    </div>
  );
  const cls = "block rounded-xl bg-primary px-3 py-2 text-primary-foreground shadow-[0_10px_24px_-16px_hsl(var(--primary))]";
  return a.linkUrl ? (
    <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className={cn(cls, "transition-opacity hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2")} data-testid="link-toolkit-announcement">
      {body}
    </a>
  ) : (
    <div className={cls} role="note" data-testid="banner-toolkit-announcement">{body}</div>
  );
}

export function CreatorToolkit({ email, onEnterChallenge }: { email: string; onEnterChallenge: () => void }) {
  const { data, isLoading, isError } = useQuery<ToolkitView>({ queryKey: ["/api/toolkit"] });
  if (isError) return null;
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-72 rounded-2xl" />)}
      </div>
    );
  }
  const cards = data.tools.length + (data.challenge.enabled ? 1 : 0);
  if (cards === 0 && !data.awards.enabled && !data.announcement) return null;
  return (
    <section className="space-y-4" aria-labelledby="toolkit-heading" data-testid="section-creator-toolkit">
      <h2 id="toolkit-heading" className="text-base font-semibold tracking-tight">Creator Toolkit</h2>
      {data.announcement && <AnnouncementBar a={data.announcement} />}
      {cards > 0 && (
        <div className={cn("grid gap-4", cards === 1 ? "sm:grid-cols-2 lg:grid-cols-3" : cards === 2 ? "sm:grid-cols-2" : "sm:grid-cols-2 lg:grid-cols-3")}>
          {data.tools.map((t, i) => <ToolCardView key={t.slot} tool={t} tone={TONES[i === 0 ? 0 : 1]} />)}
          {data.challenge.enabled && <ChallengeCardView data={data} tone={TONES[4]} onEnter={onEnterChallenge} />}
        </div>
      )}
      {data.awards.enabled && <AwardsBannerView awards={data.awards} registeredHandle={data.registeredHandle} email={email} />}
    </section>
  );
}
