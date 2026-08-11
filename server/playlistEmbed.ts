/**
 * The playlist embed — the script a publisher actually pastes into their site.
 *
 * ── It did not exist ─────────────────────────────────────────────────────────
 * `buildPlaylistEmbedCode` has been handing publishers this since the Replit
 * migration:
 *
 *     <div id="mat-playlist-12" …></div>
 *     <script src="https://your-app.replit.dev/embed/playlist.js" async></script>
 *
 * Two faults in one line. `your-app.replit.dev` is a placeholder for a domain
 * nobody owns, and `/embed/playlist.js` was never written. So every published
 * playlist embed requested a non-existent script from the wrong host and drew
 * nothing at all — silently, because a failed async script logs to a console
 * the publisher is not looking at.
 *
 * ── What it has to get right ─────────────────────────────────────────────────
 * A playlist mixes videos from DIFFERENT CREATORS. So carousel settings are
 * resolved per video against that video's own creator's brand kit, not once
 * for the playlist. Getting this wrong would paint one creator's brand over
 * another's work.
 *
 * Each item also carries its own `utmCode`. That is how a publisher's repost
 * is attributed and therefore how they are paid, so it must follow the item,
 * never the playlist.
 */
import { sanitisePlaylistStyle, styleFromPlaylist, isWatermark, logoPositionCss, type PlaylistStyle } from "../shared/playlistStyle";
import { withAlpha } from "../shared/carousel";

/** One playable entry, already resolved and safe to serialise into the script. */
export interface PlaylistEmbedItem {
  videoId: string;
  title: string;
  videoUrl: string;
  utm: string;
  /** Carousel styles for THIS video's creator — see the note above. */
  carousel: Record<string, string>;
  products: unknown[];
}

/** Resolve a playlist row into a validated style object. */
export function resolvePlaylistStyle(row: Record<string, any> | null | undefined): PlaylistStyle {
  return sanitisePlaylistStyle(styleFromPlaylist(row));
}

/**
 * Inline styles for the frame and its controls.
 *
 * Inline rather than a stylesheet because this script injects into a page it
 * does not control: a <style> block would leak rules into the publisher's own
 * CSS and could be overridden by theirs. Inline styles on elements we created
 * affect nothing else on the page.
 */
export function playlistFrameStyles(raw: PlaylistStyle) {
  const s = sanitisePlaylistStyle(raw);

  const border = s.frameShow && s.frameBorderWidth > 0
    // pt, because her spec says "1pt - 5pt" and a designer means points.
    ? `border:${s.frameBorderWidth}pt solid ${s.frameBorderColor};`
    : "border:0;";

  return {
    frame:
      `position:relative;width:100%;max-width:640px;aspect-ratio:16/9;` +
      `background:#000;overflow:hidden;${border}` +
      `border-radius:${s.frameShow ? s.frameCornerRadius : 0}px;`,
    video: "width:100%;height:100%;object-fit:contain;display:block;",
    playButton:
      `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);` +
      `width:${s.playButtonSize}px;height:${s.playButtonSize}px;border-radius:50%;` +
      `background:${withAlpha(s.playButtonColor, s.playButtonOpacity)};` +
      `display:${s.playAutoplay ? "none" : "flex"};align-items:center;justify-content:center;` +
      `cursor:pointer;border:0;z-index:11;`,
    audioButton:
      `position:absolute;bottom:10px;left:10px;width:${s.audioIconSize}px;height:${s.audioIconSize}px;` +
      `display:${s.audioShow ? "flex" : "none"};align-items:center;justify-content:center;` +
      `background:transparent;border:0;cursor:pointer;z-index:11;` +
      `color:${s.audioIconColor};opacity:${s.audioIconOpacity / 100};`,
    logo:
      `position:absolute;${logoPositionCss(s.logoPosition)}` +
      // A watermark is the same corner, just less present.
      `opacity:${isWatermark(s.logoPosition) ? 0.35 : 1};` +
      `max-width:22%;max-height:18%;object-fit:contain;z-index:10;pointer-events:none;`,
    /** Thumbnail strip, when a playlist holds more than one video. */
    strip:
      `display:flex;gap:6px;overflow-x:auto;margin-top:8px;scrollbar-width:none;` +
      `max-width:640px;`,
    stripItem:
      `flex:0 0 auto;width:84px;aspect-ratio:16/9;border-radius:6px;overflow:hidden;` +
      `cursor:pointer;background:#111;border:2px solid transparent;`,
    stripItemActive: `border-color:${s.frameBorderColor === "#000000" ? "#FFFFFF" : s.frameBorderColor};`,
  };
}

/** Autoplay and audio, as attributes the script applies to the <video>. */
export function playlistPlaybackFlags(raw: PlaylistStyle) {
  const s = sanitisePlaylistStyle(raw);
  return {
    autoplay: s.playAutoplay,
    // Muted regardless at first: browsers refuse sound-on autoplay, and a
    // video that silently never starts looks broken. The audio control is what
    // lets a viewer turn it on.
    showAudio: s.audioShow,
  };
}

/**
 * The script served when no id is given.
 *
 * The generated embed code is a mount div plus a bare <script src=…>, so the
 * script has to discover which playlists to draw from the page itself. It
 * finds every un-rendered mount and re-requests itself with that id.
 */
export function playlistBootstrapScript(apiBase: string): string {
  return `(function(){
  var base=${JSON.stringify(apiBase)};
  var mounts=document.querySelectorAll("[data-playlist]:not([data-mat-loaded])");
  Array.prototype.forEach.call(mounts,function(el){
    var id=parseInt(el.getAttribute("data-playlist"),10);
    if(!id){return;}
    // Marked before the request, so two copies of this tag on one page cannot
    // both render the same playlist.
    el.setAttribute("data-mat-loaded","1");
    var s=document.createElement("script");
    s.src=base+"/embed/playlist.js?id="+encodeURIComponent(id);
    s.async=true;
    document.head.appendChild(s);
  });
})();`;
}

/** Everything needed to draw one playlist. */
export interface PlaylistRenderInput {
  playlistId: number;
  apiBase: string;
  styles: ReturnType<typeof playlistFrameStyles>;
  flags: ReturnType<typeof playlistPlaybackFlags>;
  items: any[];
  logoUrl: string | null;
}

/**
 * The script that actually draws a playlist.
 *
 * Everything is built with createElement and textContent rather than innerHTML.
 * Product names and titles come from creators and this runs on a publisher's
 * page; assigning them as HTML would make any of them a script injection into
 * somebody else's site. Style strings are pre-sanitised server-side.
 */
export function playlistRenderScript(input: PlaylistRenderInput): string {
  const { playlistId, apiBase, styles, flags, items, logoUrl } = input;

  return `(function(){
  var D=${JSON.stringify({ playlistId, apiBase, styles, flags, items, logoUrl })};
  var mount=document.querySelector('[data-playlist="'+D.playlistId+'"]');
  if(!mount){return;}
  if(mount.getAttribute("data-mat-drawn")){return;}
  mount.setAttribute("data-mat-drawn","1");
  if(!D.items.length){return;}

  var idx=0;

  var frame=document.createElement("div");
  frame.style.cssText=D.styles.frame;

  var vid=document.createElement("video");
  vid.style.cssText=D.styles.video;
  vid.playsInline=true;vid.muted=true;vid.preload="auto";
  // Loop only when there is a single video; with several, "ended" is what
  // advances to the next one and a looping video never emits it.
  vid.loop=D.items.length===1;
  frame.appendChild(vid);

  var carousel=document.createElement("div");
  frame.appendChild(carousel);

  var play=document.createElement("button");
  play.type="button";play.setAttribute("aria-label","Play");
  play.style.cssText=D.styles.playButton;
  play.innerHTML='<svg width="45%" height="45%" viewBox="0 0 24 24" fill="#111" style="margin-left:8%"><polygon points="5,3 19,12 5,21"/></svg>';
  play.addEventListener("click",function(){vid.play();play.style.display="none";});
  frame.appendChild(play);

  var audio=document.createElement("button");
  audio.type="button";audio.setAttribute("aria-label","Toggle sound");
  audio.style.cssText=D.styles.audioButton;
  function drawAudio(){
    audio.innerHTML=vid.muted
      ? '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z" opacity=".55"/><path d="M2 2l20 20" stroke="currentColor" stroke-width="2"/></svg>'
      : '<svg width="100%" height="100%" viewBox="0 0 24 24" fill="currentColor"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a6.8 6.8 0 0 1 0 13.4v2.1a8.9 8.9 0 0 0 0-17.6z"/></svg>';
  }
  audio.addEventListener("click",function(){vid.muted=!vid.muted;drawAudio();});
  drawAudio();
  frame.appendChild(audio);

  if(D.logoUrl){
    var logo=document.createElement("img");
    logo.src=D.logoUrl;logo.alt="";logo.style.cssText=D.styles.logo;
    frame.appendChild(logo);
  }

  mount.appendChild(frame);

  // Thumbnail strip, only when there is more than one video to choose from.
  var strip=null,tiles=[];
  if(D.items.length>1){
    strip=document.createElement("div");
    strip.style.cssText=D.styles.strip;
    D.items.forEach(function(it,i){
      var t=document.createElement("div");
      t.style.cssText=D.styles.stripItem;
      t.title=it.title;
      var tv=document.createElement("video");
      tv.src=it.videoUrl;tv.muted=true;tv.playsInline=true;tv.preload="metadata";
      tv.style.cssText="width:100%;height:100%;object-fit:cover;pointer-events:none";
      t.appendChild(tv);
      t.addEventListener("click",function(){show(i);});
      tiles.push(t);strip.appendChild(t);
    });
    mount.appendChild(strip);
  }

  function drawCarousel(item){
    carousel.style.cssText=item.carousel.container;
    while(carousel.firstChild){carousel.removeChild(carousel.firstChild);}
    item.products.forEach(function(p){
      var a=document.createElement("a");
      a.href=p.productUrl||"#";a.target="_blank";a.rel="noopener";
      a.style.cssText=item.carousel.card;
      if(p.imageUrl){
        var img=document.createElement("img");
        img.src=p.imageUrl;img.alt="";img.style.cssText=item.carousel.image;
        a.appendChild(img);
      }
      var n=document.createElement("div");
      n.style.cssText=item.carousel.name;
      // textContent, never innerHTML — this is creator-supplied text landing
      // on a publisher's page.
      n.textContent=p.name||"";
      a.appendChild(n);
      if(p.price){
        var pr=document.createElement("div");
        pr.style.cssText=item.carousel.price;
        pr.textContent=p.price;
        a.appendChild(pr);
      }
      a.addEventListener("click",function(){track(item,"click");});
      carousel.appendChild(a);
    });
  }

  function show(i){
    idx=i;
    var item=D.items[i];
    vid.src=item.videoUrl;
    drawCarousel(item);
    tiles.forEach(function(t,j){
      t.style.cssText=D.styles.stripItem+(j===i?D.styles.stripItemActive:"");
    });
    if(D.flags.autoplay){vid.play().catch(function(){play.style.display="flex";});}
    else{play.style.display="flex";}
    track(item,"view");
  }

  // Advance through the playlist. With one video the element loops instead.
  vid.addEventListener("ended",function(){
    if(D.items.length>1){show((idx+1)%D.items.length);}
  });

  function track(item,type){
    try{
      var body=JSON.stringify({videoId:item.videoId,eventType:type,utmCode:item.utm,playlistId:D.playlistId});
      if(navigator.sendBeacon){
        navigator.sendBeacon(D.apiBase+"/api/analytics/track",new Blob([body],{type:"application/json"}));
      }else{
        fetch(D.apiBase+"/api/analytics/track",{method:"POST",headers:{"Content-Type":"application/json"},body:body,keepalive:true}).catch(function(){});
      }
    }catch(e){}
  }

  show(0);
})();`;
}
