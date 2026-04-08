import { useState, useEffect } from "react";

const announcements = [
  "CREATOR CHALLENGE OF THE WEEK",
];

export function AnnouncementBanner() {
  const [isVisible, setIsVisible] = useState(true);

  if (!isVisible) return null;

  const repeatedAnnouncements = [...announcements, ...announcements, ...announcements];

  return (
    <div 
      className="relative overflow-hidden py-1.5 my-4 bg-gradient-to-r from-[hsl(186,17%,60%)] via-[hsl(120,10%,44%)] to-[hsl(186,17%,60%)]"
      style={{
        transform: "rotate(-1deg) translateX(-2%)",
        width: "104%",
        marginLeft: "-2%",
      }}
      data-testid="banner-announcement"
    >
      <div className="flex animate-marquee whitespace-nowrap">
        {repeatedAnnouncements.map((text, index) => (
          <span 
            key={index} 
            className="mx-8 py-[10px] text-xs font-semibold uppercase tracking-wider text-white flex items-center gap-2"
          >
            <span className="text-[hsl(34,67%,70%)]">/</span>
            <span className="text-[hsl(34,67%,70%)]">/</span>
            {text}
          </span>
        ))}
      </div>
      <style>{`
        @keyframes marquee {
          0% {
            transform: translateX(0%);
          }
          100% {
            transform: translateX(-33.33%);
          }
        }
        .animate-marquee {
          animation: marquee 12s linear infinite;
        }
      `}</style>
    </div>
  );
}
