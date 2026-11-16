/**
 * Watch time: how long people actually watch a video (client, 16 Nov 2026,
 * for the creator dashboard's "average view duration").
 *
 * THE PLAYERS (the embed page, the script widget and the playlist player) add
 * up the seconds a video really plays, ignoring seeks and loops back to the
 * start, and report the running total every 15 seconds while it plays, on
 * pause and end, and with navigator.sendBeacon when the page is hidden or
 * closed. See watchTrackerJs below.
 *
 * THE SERVER keeps one row per viewing per video per UTC day and only ever
 * raises it. It never takes the client's word for more than:
 *   - the video's length (videos.duration_seconds; the player's own figure,
 *     capped at four hours, only when we have none), and
 *   - twice the wall-clock time since the row was opened, plus 30 seconds, so
 *     a forged report cannot claim an hour on its first request.
 *
 * WHO "ONE VIEWING" IS. Each page load makes a random id that lives only in
 * the page's memory (never a cookie, never storage) and the server hashes it
 * with the day and the session secret, so the stored value is the same kind of
 * one-way, day-rotating digest as analytics_events.viewer_hash. It is used
 * instead of the IP-based viewerHash because, measured on 4 Aug 2026 (see
 * server/index.ts), requests through www.mtrlzd.com do not carry a stable
 * client IP: each 15-second report could land on a different hash and split
 * one viewing into many short ones. A report without the id (an old cached
 * player) falls back to viewerHash, exactly as views are deduplicated.
 */
import crypto from "crypto";
import type { Request } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { viewerHash } from "./viewerIdentity";

/** Longest video we will believe a player about when the database has no length. */
export const MAX_VIDEO_SECONDS = 4 * 60 * 60;
/** Allowance on top of elapsed time, for the first report and clock jitter. */
export const WATCH_SLACK_SECONDS = 30;
/** Playback can run at 2x; anything faster than that is not watching. */
export const WATCH_MAX_SPEED = 2;

export const watchReportSchema = z.object({
  videoId: z.string().min(1).max(64),
  sid: z.string().regex(/^[A-Za-z0-9]{8,64}$/).optional(),
  seconds: z.number().finite().min(0).max(86_400),
  duration: z.number().finite().min(0).max(86_400).nullable().optional(),
});
export type WatchReport = z.infer<typeof watchReportSchema>;

/**
 * The body as the players send it. sendBeacon posts text/plain (a CORS
 * "simple" request, so no preflight from a publisher's page), which arrives as
 * a string; fetch with JSON arrives already parsed. Anything else is null.
 */
export function parseWatchReport(body: unknown): WatchReport | null {
  let raw = body;
  if (typeof raw === "string") {
    if (raw.length > 2048) return null;
    try { raw = JSON.parse(raw); } catch { return null; }
  }
  const parsed = watchReportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The length to cap at: the database's, else the player's (bounded), else the ceiling. */
export function resolveVideoSeconds(dbSeconds: number | null | undefined, reported: number | null | undefined): number {
  if (dbSeconds != null && Number.isFinite(dbSeconds) && dbSeconds > 0) return Math.round(dbSeconds);
  if (reported != null && Number.isFinite(reported) && reported > 0) return Math.min(Math.round(reported), MAX_VIDEO_SECONDS);
  return MAX_VIDEO_SECONDS;
}

/**
 * The seconds to store after a report: never lower than what is stored, never
 * more than the video's length or than the time since the row opened allows.
 */
export function clampWatchSeconds(input: {
  reported: number;
  previous: number;
  videoSeconds: number;
  elapsedSeconds: number;
}): number {
  const reported = Number.isFinite(input.reported) ? Math.max(0, Math.floor(input.reported)) : 0;
  const elapsed = Number.isFinite(input.elapsedSeconds) ? Math.max(0, input.elapsedSeconds) : 0;
  const cap = Math.min(Math.max(0, Math.floor(input.videoSeconds)), Math.floor(elapsed * WATCH_MAX_SPEED) + WATCH_SLACK_SECONDS);
  return Math.max(Math.max(0, Math.floor(input.previous || 0)), Math.min(reported, cap));
}

/** The stored key for one viewing: a salted digest of the page's id and the UTC day. */
export function watchViewerKey(sid: string | undefined, req: Request, now: Date = new Date()): string | null {
  if (!sid) return viewerHash(req, now);
  const salt = process.env.SESSION_SECRET ?? "mtrlzd-watch";
  return crypto.createHmac("sha256", salt).update(`watch\n${sid}\n${now.toISOString().slice(0, 10)}`).digest("hex");
}

/**
 * Store one report. Insert on the first, raise on the rest. GREATEST keeps it
 * monotonic if two reports for one viewing race.
 */
export async function recordWatchTime(input: {
  videoId: string;
  creatorId: string | null;
  key: string;
  reported: number;
  videoSeconds: number;
}): Promise<number> {
  const { db } = await import("./db");
  const first = clampWatchSeconds({ reported: input.reported, previous: 0, videoSeconds: input.videoSeconds, elapsedSeconds: 0 });
  const ins = await db.execute(sql`
    insert into video_watch_time (video_id, creator_id, viewer_hash, seconds_watched, video_seconds)
    values (${input.videoId}, ${input.creatorId}, ${input.key}, ${first}, ${input.videoSeconds})
    on conflict (video_id, viewer_hash) do nothing
    returning seconds_watched`);
  if (ins.rows.length) return first;

  const [row] = (await db.execute(sql`
    select seconds_watched, video_seconds, extract(epoch from (localtimestamp - created_at))::float8 as elapsed
    from video_watch_time where video_id = ${input.videoId} and viewer_hash = ${input.key}`)).rows as any[];
  if (!row) return 0;
  const next = clampWatchSeconds({
    reported: input.reported,
    previous: Number(row.seconds_watched) || 0,
    // The length fixed when the row opened; a later report cannot stretch it.
    videoSeconds: Number(row.video_seconds) || input.videoSeconds,
    elapsedSeconds: Number(row.elapsed) || 0,
  });
  if (next > (Number(row.seconds_watched) || 0)) {
    await db.execute(sql`
      update video_watch_time set seconds_watched = greatest(seconds_watched, ${next}), updated_at = localtimestamp
      where video_id = ${input.videoId} and viewer_hash = ${input.key}`);
  }
  return next;
}

/**
 * The browser side, shared by all three players so they measure the same way.
 * ES5, no dependencies: it runs on publishers' pages.
 *
 * Defines matWatch(video, apiBase, videoId), which returns {setVideo(id)} for
 * the playlist player to call when it moves to the next video.
 */
export function watchTrackerJs(): string {
  return `function matWatch(v,apiBase,firstId){
  var sid="";for(var i=0;i<24;i++){sid+="abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random()*36));}
  var id=firstId,acc={},sent={},last=null,timer=null;
  function flush(beacon){
    if(!id)return;
    var s=Math.floor(acc[id]||0);
    if(s<1||s<=(sent[id]||0))return;
    sent[id]=s;
    var body=JSON.stringify({videoId:id,sid:sid,seconds:s,duration:isFinite(v.duration)?Math.round(v.duration):null});
    var u=apiBase+"/api/analytics/watch";
    try{
      if(beacon&&navigator.sendBeacon&&navigator.sendBeacon(u,new Blob([body],{type:"text/plain"})))return;
      fetch(u,{method:"POST",headers:{"Content-Type":"text/plain"},body:body,keepalive:true}).catch(function(){});
    }catch(e){}
  }
  v.addEventListener("timeupdate",function(){
    var t=v.currentTime;
    if(last!==null&&!v.paused&&!v.seeking){var d=t-last;if(d>0&&d<1.5){acc[id]=(acc[id]||0)+d;}}
    last=t;
  });
  v.addEventListener("seeking",function(){last=null;});
  v.addEventListener("play",function(){last=null;if(!timer){timer=setInterval(function(){flush(false);},15000);}});
  v.addEventListener("pause",function(){flush(false);});
  v.addEventListener("ended",function(){flush(false);});
  document.addEventListener("visibilitychange",function(){if(document.visibilityState==="hidden"){flush(true);}});
  window.addEventListener("pagehide",function(){flush(true);});
  return {setVideo:function(next){flush(true);id=next;last=null;}};
}`;
}
