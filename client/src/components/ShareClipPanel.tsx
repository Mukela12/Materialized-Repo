/**
 * "Download for socials" on the Preview screen: the video as an MP4 with its
 * product carousel drawn on, to post to Stories, Reels or WhatsApp. Asked for
 * by the client in August and again on 30 Sep 2026: "Users could download the
 * preview with carousel and publish on Stories... instant marketing tool!"
 *
 * The server renders it (server/shareClip.ts); this starts that, shows how far
 * along it is, then offers Download and, where the device can, Share.
 *
 * The finished file is fetched as soon as it is ready, not when Share is
 * pressed: a phone only opens its share sheet straight from a tap, and a
 * download in between uses the tap up.
 */
import { useEffect, useRef, useState } from "react";
import { Download, Link2, Loader2, Share2, Sparkles } from "lucide-react";
import { apiRequest, serverMessage } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

type ClipStatus = "queued" | "rendering" | "ready" | "failed";
interface ClipJob { id: string; status: ClipStatus; progress: number; error?: string }

export function ShareClipPanel({ videoId, title, shoppableUrl }: {
  videoId: string;
  title: string;
  /** The shoppable video, for the caption or a Stories link sticker. */
  shoppableUrl: string;
}) {
  const { toast } = useToast();
  const [job, setJob] = useState<ClipJob | null>(null);
  const [starting, setStarting] = useState(false);
  const [file, setFile] = useState<{ url: string; file: File } | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout>>();
  const alive = useRef(true);

  // Leaving the screen stops the polling and frees the file.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; clearTimeout(poll.current); };
  }, []);
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url); }, [file]);

  const fileName = `${title.replace(/[^\w\- ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "video"}.mp4`;

  const fetchFile = async (j: ClipJob) => {
    const res = await fetch(`/api/videos/${videoId}/share-clip/${j.id}/file`, { credentials: "include" });
    if (!res.ok) throw new Error("download");
    const blob = await res.blob();
    if (!alive.current) return;
    const f = new File([blob], fileName, { type: "video/mp4" });
    setFile({ url: URL.createObjectURL(f), file: f });
  };

  const follow = async (j: ClipJob) => {
    if (!alive.current) return;
    setJob(j);
    if (j.status === "ready") {
      try { await fetchFile(j); }
      catch { setJob({ ...j, status: "failed", error: "The video was ready but didn't download. Please try again." }); }
      return;
    }
    if (j.status === "failed") return;
    poll.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/share-clip/${j.id}`, { credentials: "include" });
        if (!res.ok) throw new Error(String(res.status));
        follow(await res.json());
      } catch {
        if (alive.current) setJob({ ...j, status: "failed", error: "Lost touch with the server. Please try again." });
      }
    }, 1500);
  };

  const start = async () => {
    setStarting(true);
    setFile(null);
    try {
      const res = await apiRequest("POST", `/api/videos/${videoId}/share-clip`);
      await follow(await res.json());
    } catch (err) {
      toast({ title: "Couldn't prepare the video", description: serverMessage(err) || "Please try again.", variant: "destructive" });
    } finally {
      setStarting(false);
    }
  };

  const canShareFile = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file.file] });
  const share = async () => {
    if (!file) return;
    try {
      await navigator.share({ files: [file.file], title });
    } catch (err: any) {
      if (err?.name !== "AbortError") toast({ title: "Couldn't open sharing", description: "Download it instead, then post it from your photos.", variant: "destructive" });
    }
  };
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shoppableUrl);
      toast({ title: "Link copied", description: "Paste it in your caption, or as a link sticker on your story." });
    } catch {
      toast({ title: "Couldn't copy the link", variant: "destructive" });
    }
  };

  const working = starting || job?.status === "queued" || job?.status === "rendering" || (job?.status === "ready" && !file);

  return (
    <div className="rounded-xl border bg-card p-4 space-y-3" data-testid="share-clip-panel">
      <div>
        <p className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Share on socials
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Download your video with the product carousel on it, for Stories, Reels or WhatsApp. The buttons can't be tapped in a
          downloaded video, so add your shoppable link in the caption or as a link sticker.
        </p>
      </div>

      {working ? (
        <div className="space-y-1.5" data-testid="share-clip-progress">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {job?.status === "queued" ? "Waiting to start…" : job?.status === "ready" ? "Almost there…" : "Preparing your video…"}
          </p>
          <Progress value={job?.status === "ready" ? 100 : job?.progress ?? 0} className="h-1.5" />
        </div>
      ) : file ? (
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm" className="gap-1.5 rounded-full">
            <a href={file.url} download={fileName} data-testid="button-download-clip">
              <Download className="h-4 w-4" /> Download video
            </a>
          </Button>
          {canShareFile && (
            <Button size="sm" variant="outline" className="gap-1.5 rounded-full" onClick={share} data-testid="button-share-clip">
              <Share2 className="h-4 w-4" /> Share
            </Button>
          )}
          <Button size="sm" variant="ghost" className="gap-1.5 rounded-full" onClick={copyLink} data-testid="button-copy-shoppable-link">
            <Link2 className="h-4 w-4" /> Copy shoppable link
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {job?.status === "failed" && (
            <p className="text-xs text-destructive" data-testid="share-clip-error">{job.error}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5 rounded-full" onClick={start} data-testid="button-prepare-clip">
              <Download className="h-4 w-4" /> {job?.status === "failed" ? "Try again" : "Download for socials"}
            </Button>
            <Button size="sm" variant="ghost" className="gap-1.5 rounded-full" onClick={copyLink} data-testid="button-copy-shoppable-link">
              <Link2 className="h-4 w-4" /> Copy shoppable link
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
