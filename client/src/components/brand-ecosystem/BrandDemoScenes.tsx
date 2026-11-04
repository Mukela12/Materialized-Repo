import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { SiInstagram, SiTiktok } from "react-icons/si";
import { Check, ChevronDown, Heart, MoreHorizontal, Newspaper, Search, Send, Share, ShoppingBag, Store, Video, X } from "lucide-react";
import "./BrandDemoScenes.css";

/**
 * Brand demo slides 2 to 5, rebuilt from the client's notes of 4 Nov 2026:
 * real devices in the homepage's chrome frames, the hero's one-product card,
 * an Instagram Story that reads like one, an imported roster with video
 * metrics, and a library pick that pays the brand, creator and publisher.
 */

export type SceneProps = { active: boolean; reducedMotion: boolean };

const STORY_VIDEO = "/paris-commerce-demo.webm";
const STORY_POSTER = "/paris-commerce-demo-poster.webp";

/** The hero's product card, with its one product. */
const PRODUCT = { brand: "MIRO MISLJEN", name: "Little Black Dress", price: "€790" };

function useIsPhone() {
  const query = "(max-width: 600px)";
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setPhone(list.matches);
    list.addEventListener?.("change", update);
    return () => list.removeEventListener?.("change", update);
  }, []);
  return phone;
}

/** Counts from 0 to `to` after `delay` ms, holding still while the slideshow is paused. */
function useCountUp(to: number, delay: number, duration: number, { active, reducedMotion }: SceneProps) {
  const [value, setValue] = useState(reducedMotion ? to : 0);
  const elapsed = useRef(0);
  useEffect(() => {
    if (reducedMotion) {
      setValue(to);
      return;
    }
    if (!active) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const t = Math.min(1, Math.max(0, (elapsed.current - delay) / duration));
      setValue(Math.round(to * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, reducedMotion, to, delay, duration]);
  return value;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

function DemoVideo({ active, className }: { active: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    if (active) video.play()?.catch(() => undefined);
    else video.pause();
  }, [active]);
  return (
    <video ref={ref} className={className} src={STORY_VIDEO} poster={STORY_POSTER} muted loop playsInline preload="metadata" tabIndex={-1} />
  );
}

function ChromePhone({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`bx-phone ${className}`}>
      <div className="bx-phone-screen">{children}</div>
      <img className="bx-phone-frame" src="/media/demo-phone-frame.webp" alt="" draggable={false} />
    </div>
  );
}

function ChromeTablet({ children }: { children: ReactNode }) {
  return (
    <div className="bx-tablet">
      <div className="bx-tablet-screen">{children}</div>
      <img className="bx-tablet-frame" src="/media/demo-tablet-frame.webp" alt="" draggable={false} />
    </div>
  );
}

function ProductCard({ tapped = false }: { tapped?: boolean }) {
  return (
    <div className="bx-product-card">
      <span className="bx-product-brand">{PRODUCT.brand}</span>
      <span className="bx-product-name">{PRODUCT.name}</span>
      <span className="bx-product-price">{PRODUCT.price}</span>
      <span className={`bx-product-buy${tapped ? " is-tapped" : ""}`}>BUY NOW</span>
    </div>
  );
}

function InstagramMark({ size = 30 }: { size?: number }) {
  return (
    <span className="bx-mark bx-mark-ig" style={{ width: size, height: size }} aria-label="Instagram" role="img">
      <SiInstagram />
    </span>
  );
}

function TikTokMark({ size = 30 }: { size?: number }) {
  return (
    <span className="bx-mark bx-mark-tt" style={{ width: size, height: size }} aria-label="TikTok" role="img">
      <SiTiktok />
    </span>
  );
}

/* Slide 2: the creator's video on the brand's own product page. */

function ProductPage({ phone, active }: { phone: boolean; active: boolean }) {
  return (
    <div className={`bx-shop${phone ? " is-phone" : ""}`}>
      <div className="bx-shop-nav">
        <Search className="bx-shop-icon" aria-hidden="true" />
        <span className="bx-shop-wordmark">{PRODUCT.brand}</span>
        <span className="bx-shop-bag">
          <ShoppingBag className="bx-shop-icon" aria-hidden="true" />
          <i className="bx-shop-count">1</i>
        </span>
      </div>
      <div className="bx-shop-body">
        <div className="bx-shop-gallery">
          <div className="bx-shop-thumbs">
            <span className="bx-shop-thumb is-video">
              <img src={STORY_POSTER} alt="" />
              <i aria-hidden="true" />
            </span>
            <span className="bx-shop-thumb is-detail"><img src={STORY_POSTER} alt="" /></span>
            <span className="bx-shop-thumb is-close"><img src={STORY_POSTER} alt="" /></span>
          </div>
          <div className="bx-shop-player">
            <DemoVideo active={active} className="bx-shop-video" />
            <div className="bx-shop-card"><ProductCard tapped /></div>
            <span className="bx-tap" aria-hidden="true" />
          </div>
        </div>
        <div className="bx-shop-details">
          <span className="bx-shop-crumb">Dresses</span>
          <strong className="bx-shop-title">{PRODUCT.name}</strong>
          <span className="bx-shop-price">{PRODUCT.price}</span>
          <span className="bx-shop-label">Size</span>
          <span className="bx-shop-sizes"><i>XS</i><i className="is-on">S</i><i>M</i><i>L</i></span>
          <span className="bx-shop-add">Add to bag</span>
          <span className="bx-shop-note">Free delivery and returns</span>
        </div>
      </div>
    </div>
  );
}

export function StorefrontScene({ active }: SceneProps) {
  const phone = useIsPhone();
  return (
    <div className="be-illustration bx-storefront" aria-hidden="true">
      {phone ? (
        <ChromePhone className="bx-storefront-phone"><ProductPage phone active={active} /></ChromePhone>
      ) : (
        <ChromeTablet><ProductPage phone={false} active={active} /></ChromeTablet>
      )}
    </div>
  );
}

/* Slide 3: an Instagram Story with the shoppable video, then where it can go. */

export function SocialScene({ active }: SceneProps) {
  return (
    <div className="be-illustration bx-social" aria-hidden="true">
      <ChromePhone className="bx-story-phone">
        <div className="bx-story">
          <DemoVideo active={active} className="bx-story-video" />
          <div className="bx-story-shade" />
          <div className="bx-status"><span>9:41</span><span className="bx-status-icons"><i /><i /><b /></span></div>
          <div className="bx-story-progress"><i className="is-done" /><i className="is-playing" /><i /></div>
          <div className="bx-story-head">
            <span className="bx-story-avatar"><img src="/mtrlzd-wordmark.png" alt="" /></span>
            <b>join.materialized</b>
            <span className="bx-story-time">2h</span>
            <MoreHorizontal className="bx-story-icon" />
            <X className="bx-story-icon" />
          </div>
          <div className="bx-story-product"><ProductCard /></div>
          <div className="bx-story-hearts"><Heart /><Heart /><Heart /></div>
          <div className="bx-story-reply">
            <span>Send message</span>
            <Heart className="bx-story-icon" />
            <Send className="bx-story-icon" />
          </div>
        </div>
      </ChromePhone>
      <div className="bx-share-line">
        <span className="bx-share-icon"><Share /></span>
        <span className="bx-share-text"><b>Share</b> your interactive video previews to</span>
        <span className="bx-share-marks"><InstagramMark /><TikTokMark /></span>
      </div>
    </div>
  );
}

/* Slide 4: one imported roster, with each creator's video metrics. */

/* Photos from Unsplash (free licence), self-hosted and shrunk: creators photo-1617206710131,
   photo-1785273926014, photo-1554151228, photo-1530882548122; library photo-1718948740091,
   photo-1697222564085, photo-1779942578833, photo-1659100777438. People shown are illustrative. */
const CREATOR_PHOTOS = {
  travel: "/media/demo/creator-travel.webp",
  fashion: "/media/demo/creator-fashion.webp",
  beauty: "/media/demo/creator-beauty.webp",
  auto: "/media/demo/creator-auto.webp",
};

const roster = [
  { name: "Mia Laurent", handle: "@miawanders", category: "Travel", photo: CREATOR_PHOTOS.travel, videos: 24, views: 182, sales: 6420 },
  { name: "Amara Okafor", handle: "@amarawears", category: "Fashion", photo: CREATOR_PHOTOS.fashion, videos: 41, views: 356, sales: 12880 },
  { name: "Ella Novak", handle: "@ellaglow", category: "Beauty", photo: CREATOR_PHOTOS.beauty, videos: 33, views: 248, sales: 8150 },
  { name: "Marco Ruiz", handle: "@marcodrives", category: "Auto", photo: CREATOR_PHOTOS.auto, videos: 18, views: 129, sales: 4960 },
];

function RosterRow({ person, index, scene }: { person: (typeof roster)[number]; index: number; scene: SceneProps }) {
  const start = 1500 + index * 120;
  const videos = useCountUp(person.videos, start, 1100, scene);
  const views = useCountUp(person.views, start, 1100, scene);
  const sales = useCountUp(person.sales, start, 1100, scene);
  return (
    <div className="bx-roster-row" style={{ animationDelay: `${0.95 + index * 0.12}s` }}>
      <span className="bx-roster-person">
        <img className="bx-roster-photo" src={person.photo} alt="" />
        <span><b>{person.name}</b><small>{person.handle}</small></span>
      </span>
      <span className="bx-roster-category">{person.category}</span>
      <span className="bx-roster-num is-videos">{videos}</span>
      <span className="bx-roster-num">{views}k</span>
      <span className="bx-roster-num is-sales">{money(sales)}</span>
    </div>
  );
}

export function ImportScene(scene: SceneProps) {
  return (
    <div className="be-illustration bx-import" aria-hidden="true">
      <div className="bx-roster">
        <div className="bx-roster-top">
          <span className="bx-roster-title"><b>Influencer program</b><small>4 creators invited with free access</small></span>
          <span className="bx-file">
            <span className="bx-file-badge">CSV</span>
            <span className="bx-file-name">influencer-program.csv</span>
            <span className="bx-file-done"><Check /></span>
            <span className="bx-file-bar"><i /></span>
          </span>
        </div>
        <div className="bx-roster-row is-head">
          <span>Creator</span><span>Category</span><span className="is-videos">Videos</span><span>Views</span><span>Sales</span>
        </div>
        {roster.map((person, index) => <RosterRow key={person.handle} person={person} index={index} scene={scene} />)}
      </div>
    </div>
  );
}

/* Slide 5: pick a Travel video from the library; the brand, creator and publisher all earn. */

const LIBRARY_PHOTOS = {
  airline: "/media/demo/travel-airline.webp",
  adventure: "/media/demo/travel-adventure.webp",
  hotel: "/media/demo/travel-hotel.webp",
  dining: "/media/demo/travel-dining.webp",
};

const library = [
  { title: "Business class, Tokyo", genre: "Airline review", handle: "@miawanders", time: "0:42", photo: LIBRARY_PHOTOS.airline },
  { title: "Ridge hike at sunrise", genre: "Adventure", handle: "@trailwithtom", time: "1:05", photo: LIBRARY_PHOTOS.adventure },
  { title: "Santorini suite tour", genre: "Hotel review", handle: "@miawanders", time: "0:38", photo: LIBRARY_PHOTOS.hotel, picked: true },
  { title: "Dinner on the terrace", genre: "Dining", handle: "@eatwithines", time: "0:51", photo: LIBRARY_PHOTOS.dining },
];

export function LibraryScene(scene: SceneProps) {
  const sales = useCountUp(86, 3300, 1700, scene);
  const revenue = useCountUp(6880, 3300, 1700, scene);
  const creator = useCountUp(688, 3300, 1700, scene);
  const publisher = useCountUp(344, 3300, 1700, scene);
  const picked = library.find((video) => video.picked)!;
  return (
    <div className="be-illustration bx-library" aria-hidden="true">
      <div className="bx-lib">
        <div className="bx-lib-top">
          <b>Global Content Library</b>
          <span className="bx-select">
            <span className="bx-select-value"><span className="is-before">All categories</span><span className="is-after">Travel</span></span>
            <ChevronDown />
            <span className="bx-select-menu">
              <i>Fashion</i><i>Beauty</i><i>Auto</i><i className="is-pick">Travel</i>
            </span>
          </span>
        </div>
        <div className="bx-lib-grid">
          {library.map((video, index) => (
            <div className={`bx-lib-card${video.picked ? " is-picked" : ""}`} key={video.title} style={{ animationDelay: `${1.45 + index * 0.06}s` }}>
              <span className="bx-lib-thumb">
                <img src={video.photo} alt="" />
                <span className="bx-lib-time">{video.time}</span>
                {video.picked && <span className="bx-lib-check"><Check /></span>}
              </span>
              <span className="bx-lib-meta">
                <b>{video.title}</b>
                <span className="bx-lib-genre">{video.genre}</span>
                <small>{video.handle}</small>
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="bx-earn">
        <div className="bx-earn-tile is-brand">
          <span className="bx-earn-head"><Store /> Brand</span>
          <span className="bx-drop"><img src={picked.photo} alt="" /><small>Published</small></span>
          <strong>{money(revenue)}</strong>
          <small>{sales} sales</small>
        </div>
        <div className="bx-earn-tile">
          <span className="bx-earn-head"><Video /> Creator</span>
          <strong>{money(creator)}</strong>
          <small>{picked.handle}</small>
        </div>
        <div className="bx-earn-tile">
          <span className="bx-earn-head"><Newspaper /> Publisher</span>
          <strong>{money(publisher)}</strong>
          <small>Travel Magazine</small>
        </div>
      </div>
    </div>
  );
}
