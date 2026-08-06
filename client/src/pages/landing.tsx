import { CURRENCY_SYMBOL, PLATFORM_CURRENCY_CODE } from "@/lib/currency";
import { videoDeliveryUrl } from "@shared/videoDelivery";
import { planPriceMajor, setupFeeMajor, PLAN_ALLOWANCES, OVERAGE_RATES, type PlanKey } from "@shared/plans";
import { PricingEstimator } from "@/components/PricingEstimator";
import { useState, useEffect, useRef } from "react";
import { motion, useScroll, useTransform, AnimatePresence } from "framer-motion";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import starIcon from "@assets/Materialized_Star_icon_1773416195409.png";
import chromeBlobIcon from "@assets/2Iconography_Icons_1773417096477.png";
import bagCartImage from "@assets/bag_cart_1773417992382.png";
import celineBagImage from "@assets/celine_bag_1773420370038.png";
import iphoneFrameTransparent from "@assets/iphone_frame_transparent.png";
import tabletFrameTransparent from "@assets/tablet_frame_transparent.png";
import chromeTabletFrame from "@/assets/chrome_tablet_frame_no_bg.png";
import { COUNTRIES } from "@shared/schema";
import { Play, ChevronDown, Users, DollarSign, TrendingUp, ShoppingBag, ArrowRight, Star, Smartphone, Monitor, Video, Volume2, VolumeX, CircleUserRound, Check } from "lucide-react";
import { DemoPopup } from "@/components/DemoPopup";
import { SiInstagram, SiLinkedin } from "react-icons/si";
// Landing page videos hosted on Cloudinary
const heroVideo = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609692/materialized/landing/hero-video.mp4", "player");
const discoveryPacksVideo = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609709/materialized/landing/discovery-packs.mp4", "player");
const verticalDemoVideo = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609713/materialized/landing/vertical-demo.mp4", "player");
import materializedLogo from "@assets/MTRLZD_Logo_white_transparent.png";

const streetStyleVideo = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609784/materialized/public/street-style-ss26.mp4", "player");
const mtrlzdVideoBanner = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1784819097/materialized/landing/mtrlzd-video-banner.mp4", "player");
const miroMisljenDressVideo = videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609824/materialized/public/miro-misljen-dress.mp4", "player");

const formSchema = z.object({
  role: z.enum(["creator", "brand", "publisher"]),
  firstName: z.string().min(1, "First name is required"),
  surname: z.string().min(1, "Surname is required"),
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  instagramHandle: z.string().optional(),
  tiktokHandle: z.string().optional(),
  country: z.string().optional(),
  city: z.string().optional(),
  accessCode: z.string().optional(),
});
type FormData = z.infer<typeof formSchema>;

const contactSchema = z.object({
  firstName: z.string().min(1, "Required"),
  surname: z.string().min(1, "Required"),
  email: z.string().email("Valid email required"),
  role: z.enum(["creator", "brand", "publisher"], { required_error: "Select a role" }),
  igHandle: z.string().min(1, "Required"),
  message: z.string().min(1, "Required").max(200, "Max 200 characters"),
});
type ContactData = z.infer<typeof contactSchema>;

function ContactForm() {
  const { toast } = useToast();
  const [sent, setSent] = useState(false);
  const form = useForm<ContactData>({
    resolver: zodResolver(contactSchema),
    defaultValues: { firstName: "", surname: "", email: "", role: undefined, igHandle: "", message: "" },
  });
  const msg = form.watch("message") ?? "";

  const mutation = useMutation({
    mutationFn: (data: ContactData) => apiRequest("POST", "/api/contact", data),
    onSuccess: () => {
      setSent(true);
      form.reset();
    },
    onError: () => toast({ title: "Couldn't send", description: "Please try again shortly.", variant: "destructive" }),
  });

  if (sent) {
    return (
      <div className="text-center py-4">
        <p className="text-[#1351aa] font-semibold text-sm">Message sent!</p>
        <p className="text-white/50 text-xs mt-1">We'll be in touch soon.</p>
        <button onClick={() => setSent(false)} className="mt-3 text-xs text-white/40 underline">Send another</button>
      </div>
    );
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-3">
        {/* Name row */}
        <div className="grid grid-cols-2 gap-2">
          <FormField control={form.control} name="firstName" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-white/60 text-xs">First Name *</FormLabel>
              <FormControl>
                <input {...field} data-testid="input-contact-firstName" placeholder="Jane"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#1351aa] transition-colors" />
              </FormControl>
              <FormMessage className="text-xs text-red-400" />
            </FormItem>
          )} />
          <FormField control={form.control} name="surname" render={({ field }) => (
            <FormItem className="space-y-1">
              <FormLabel className="text-white/60 text-xs">Surname *</FormLabel>
              <FormControl>
                <input {...field} data-testid="input-contact-surname" placeholder="Smith"
                  className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#1351aa] transition-colors" />
              </FormControl>
              <FormMessage className="text-xs text-red-400" />
            </FormItem>
          )} />
        </div>

        {/* Email */}
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem className="space-y-1">
            <FormLabel className="text-white/60 text-xs">Email *</FormLabel>
            <FormControl>
              <input {...field} type="email" data-testid="input-contact-email" placeholder="you@example.com"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#1351aa] transition-colors" />
            </FormControl>
            <FormMessage className="text-xs text-red-400" />
          </FormItem>
        )} />

        {/* Role radio */}
        <FormField control={form.control} name="role" render={({ field }) => (
          <FormItem className="space-y-1">
            <FormLabel className="text-white/60 text-xs">I am a *</FormLabel>
            <div className="flex gap-2">
              {(["creator", "brand", "publisher"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => field.onChange(r)}
                  data-testid={`radio-role-${r}`}
                  className={`flex-1 py-2 rounded-lg border text-xs font-medium transition-all ${
                    field.value === r
                      ? "border-[#1351aa] bg-[#1351aa]/20 text-[#6b8fd6]"
                      : "border-white/10 text-white/40 hover:border-white/30 hover:text-white/60"
                  }`}
                >
                  {r === "creator" ? "Creator" : r === "brand" ? "Brand" : "Publisher"}
                </button>
              ))}
            </div>
            <FormMessage className="text-xs text-red-400" />
          </FormItem>
        )} />

        {/* IG handle */}
        <FormField control={form.control} name="igHandle" render={({ field }) => (
          <FormItem className="space-y-1">
            <FormLabel className="text-white/60 text-xs">Instagram Handle *</FormLabel>
            <FormControl>
              <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden focus-within:border-[#1351aa] transition-colors">
                <span className="px-3 text-white/30 text-sm select-none">@</span>
                <input {...field} data-testid="input-contact-igHandle" placeholder="yourhandle"
                  className="flex-1 bg-transparent py-2 pr-3 text-white text-sm placeholder:text-white/30 focus:outline-none"
                  onChange={e => field.onChange(e.target.value.replace(/^@/, ""))} />
              </div>
            </FormControl>
            <FormMessage className="text-xs text-red-400" />
          </FormItem>
        )} />

        {/* Message */}
        <FormField control={form.control} name="message" render={({ field }) => (
          <FormItem className="space-y-1">
            <div className="flex items-center justify-between">
              <FormLabel className="text-white/60 text-xs">Message *</FormLabel>
              <span className={`text-xs ${msg.length > 190 ? "text-amber-400" : "text-white/30"}`}>{msg.length}/200</span>
            </div>
            <FormControl>
              <textarea {...field} data-testid="textarea-contact-message" rows={3} maxLength={200}
                placeholder="Tell us a bit about yourself and what you're looking for..."
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm placeholder:text-white/30 focus:outline-none focus:border-[#1351aa] transition-colors resize-none" />
            </FormControl>
            <FormMessage className="text-xs text-red-400" />
          </FormItem>
        )} />

        <button
          type="submit"
          disabled={mutation.isPending}
          data-testid="button-contact-submit"
          className="w-full py-2.5 rounded-full bg-[#1351aa] text-white font-semibold text-sm hover:bg-[#0f4189] transition-colors disabled:opacity-50 mt-1"
        >
          {mutation.isPending ? "Sending..." : "Connect"}
        </button>
      </form>
    </Form>
  );
}

const TYPEWRITER_PHRASES = [
  "Turn videos into revenue",
  "Connect with brands",
  "Build your affiliate empire",
  "Monetise your content",
];

function TypewriterText() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [charIndex, setCharIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    const currentPhrase = TYPEWRITER_PHRASES[phraseIndex];
    const typingSpeed = isDeleting ? 50 : 100;
    const pauseDuration = 2000;

    if (!isDeleting && charIndex === currentPhrase.length) {
      setTimeout(() => setIsDeleting(true), pauseDuration);
      return;
    }

    if (isDeleting && charIndex === 0) {
      setIsDeleting(false);
      setPhraseIndex((prev) => (prev + 1) % TYPEWRITER_PHRASES.length);
      return;
    }

    const timeout = setTimeout(() => {
      setCharIndex((prev) => (isDeleting ? prev - 1 : prev + 1));
    }, typingSpeed);

    return () => clearTimeout(timeout);
  }, [charIndex, isDeleting, phraseIndex]);

  return (
    <span className="inline-block min-w-[280px] text-center text-[22px]">
      {TYPEWRITER_PHRASES[phraseIndex].slice(0, charIndex)}
      <span className="animate-pulse">|</span>
    </span>
  );
}

const STATS = [
  { icon: Users, value: "50K+", label: "Active Creators", color: "text-[#1351aa]" },
  { icon: DollarSign, value: "$12M", label: "Creator Earnings", color: "text-[#1351aa]" },
  { icon: TrendingUp, value: "340%", label: "Avg. ROI Increase", color: "text-[#43484D]" },
  { icon: ShoppingBag, value: "2.1M", label: "Products Tagged", color: "text-[#1351aa]" },
];

const TESTIMONIALS = [
  {
    quote: "Most Innovative Tech",
    author: "",
    role: "",
    company: "Forbes",
  },
  {
    quote: "Top 100 Fast Moving Companies",
    author: "",
    role: "",
    company: "Fast Company",
  },
  {
    quote: "Touch Technology Tells Brands Exactly What Consumers WANT To Shop",
    author: "",
    role: "",
    company: "Fashionista",
  },
];

function AnimatedCounter({ value, suffix = "" }: { value: string; suffix?: string }) {
  const numericValue = parseFloat(value.replace(/[^0-9.]/g, ""));
  const prefix = value.replace(/[0-9.]/g, "").replace(suffix, "");
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!inView) return;
    const duration = 2000;
    const steps = 60;
    const increment = numericValue / steps;
    let current = 0;

    const timer = setInterval(() => {
      current += increment;
      if (current >= numericValue) {
        setCount(numericValue);
        clearInterval(timer);
      } else {
        setCount(current);
      }
    }, duration / steps);

    return () => clearInterval(timer);
  }, [inView, numericValue]);

  return (
    <span ref={ref}>
      {prefix}{count >= 1000 ? `${(count / 1000).toFixed(count >= 10000 ? 0 : 1)}K` : Math.round(count)}{suffix.includes("+") ? "+" : suffix.includes("%") ? "%" : suffix.includes("M") ? "M" : ""}
    </span>
  );
}

function StatsSection() {
  return (
    <section className="relative px-4 bg-[#33415c]" style={{ paddingTop: "100px", paddingBottom: "40px" }}>
      <div className="max-w-6xl mx-auto text-center">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-3xl md:text-4xl font-bold text-center mb-6 text-white"
        >
          Video Commerce
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="md:text-xl text-white/80 max-w-2xl mx-auto text-[16px] not-italic"
        >
          <em className="italic">Shoppable video technology</em> has existed for more than a decade. Materialized has built an affiliate eco-system that rewards reposts, where content provides multi-layered revenues and impact
        </motion.p>
      </div>
    </section>
  );
}

function TestimonialCarousel() {
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % TESTIMONIALS.length);
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <section className="pt-4 pb-10 px-4 bg-[#33415c]">
      <div className="max-w-4xl mx-auto">
        <div className="relative min-h-[160px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeIndex}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.5 }}
              className="text-center"
            >
              <svg width="48" height="36" viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg" className="mx-auto mb-4">
                <defs>
                  <linearGradient id="chrome-grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
                    <stop offset="30%" stopColor="#c0c0c0" stopOpacity={0.85} />
                    <stop offset="60%" stopColor="#888888" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#d4d4d4" stopOpacity={0.9} />
                  </linearGradient>
                </defs>
                <text x="0" y="36" fontSize="56" fontFamily="Georgia, serif" fill="url(#chrome-grad)">&ldquo;</text>
              </svg>
              <p className="text-lg md:text-xl text-white/90 mb-3 italic leading-relaxed">
                {TESTIMONIALS[activeIndex].quote}
              </p>
              <div className="text-[#1351aa] font-semibold text-sm mt-2">
                <span className="text-white/30 mr-2">|</span>{TESTIMONIALS[activeIndex].company}
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex justify-center gap-1.5 mt-5" role="tablist" aria-label="Testimonial navigation">
          {TESTIMONIALS.map((testimonial, index) => (
            <button
              key={index}
              onClick={() => setActiveIndex(index)}
              className={`h-[2px] rounded-full transition-all ${
                index === activeIndex ? "bg-[#1351aa] w-6" : "bg-white/20 w-4"
              }`}
              data-testid={`button-testimonial-${index}`}
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`View testimonial from ${testimonial.author}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function VideoOrientationSection() {
  return (
    <section className="py-20 px-4 bg-[#00000094]">
      <div className="max-w-6xl mx-auto">
        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="md:text-4xl font-bold text-center mb-8 text-white text-[24px] px-[10px]"
        >
          One Platform,<br />
          <span style={{ color: "transparent", WebkitTextStroke: "1.5px white" }}>Every Format</span>
        </motion.h2>
        <p className="text-center text-muted-foreground mb-12 max-w-2xl mx-auto">
          Upload your Reels or Film Series for dynamic product carousels on all content formats
        </p>
        <div className="grid md:grid-cols-2 gap-8">
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
          >
            <div className="flex flex-col items-center gap-0">
              <div
                className="relative w-[220px] md:w-[260px]"
                style={{ aspectRatio: "1024 / 1536" }}
              >
                {/* Screen area — inset to match the frame's cutout, clipped edge-to-edge */}
                <div
                  className="absolute overflow-hidden z-0"
                  style={{ top: "2.6%", bottom: "3.3%", left: "21.5%", right: "16.6%", borderRadius: "30px" }}
                >
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    aria-label="Vertical video demo"
                  >
                    <source src={verticalDemoVideo} type="video/mp4" />
                  </video>
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {/* Bag product carousel — bottom of screen */}
                  <div className="absolute left-2 right-2 z-10" style={{ bottom: 5 }}>
                    <div className="bg-black/40 backdrop-blur-md rounded-lg px-2 py-1.5 border border-white/10">
                      <div className="flex items-center gap-1.5">
                        <div className="w-7 h-7 rounded-md bg-white/10 flex-shrink-0 overflow-hidden">
                          <img src={bagCartImage} alt="Metallic Chain Handbag" className="w-full h-full object-contain" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-white/70 text-[7px] leading-tight truncate">Metallic Chain Bag</div>
                          <div className="text-white font-bold text-[10px] leading-tight">{CURRENCY_SYMBOL}720</div>
                        </div>
                        <button className="bg-white/90 text-[#43484D] text-[6.5px] font-black tracking-wide px-1.5 py-1 rounded flex-shrink-0">
                          BUY NOW
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Transparent iPhone frame overlay */}
                <img
                  src={iphoneFrameTransparent}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full z-10 pointer-events-none select-none"
                  style={{ filter: "drop-shadow(0 25px 60px rgba(0,0,0,0.4)) drop-shadow(0 10px 20px rgba(0,0,0,0.3))" }}
                />
              </div>
              {/* Format label */}
              <div className="w-[220px] md:w-[260px] px-1 pt-3 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-sm">Vertical</div>
                  <div className="text-white/60 text-xs">9:16</div>
                </div>
                <div className="text-white/50 text-[10px] font-bold tracking-widest uppercase">REELS</div>
              </div>
            </div>
          </motion.div>
          <motion.div
            initial={{ opacity: 0, x: 30 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            className="flex justify-center"
          >
            {/* iPad landscape frame */}
            <div className="flex flex-col items-center gap-0 w-full max-w-[560px]">
              <div className="relative w-full" style={{ aspectRatio: "1536 / 1024" }}>
                {/* Screen area — inset to match the frame's cutout, clipped edge-to-edge */}
                <div
                  className="absolute overflow-hidden z-0"
                  style={{ top: "6.0%", bottom: "5.4%", left: "5.3%", right: "4.2%", borderRadius: "30px" }}
                >
                  <video
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ objectPosition: "center 60%" }}
                    aria-label="Jetski vessels video"
                  >
                    <source src={videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609801/materialized/public/vessels-jetski.mp4", "player")} type="video/mp4" />
                  </video>
                  {/* Subtle screen glare */}
                  <div className="absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent pointer-events-none" />
                  {/* Seasonal Leasing carousel card — bottom of screen */}
                  <div className="absolute left-3 right-3 z-10" style={{ bottom: 5 }}>
                    <div className="rounded-xl px-3 py-2 border border-white/15" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(12px)" }}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-white/50 text-[8px] uppercase tracking-widest leading-tight">Lund Group</div>
                          <div className="text-white text-[11px] font-semibold leading-tight mt-0.5">Luxury Yacht Charters</div>
                        </div>
                        <a
                          href="https://www.lund-group.com"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="bg-white/10 hover:bg-white/20 text-white text-[8px] font-black tracking-wider px-3 py-1.5 rounded-lg flex-shrink-0 border border-white/20 transition-colors whitespace-nowrap"
                        >
                          SEASONAL LEASING
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Transparent tablet frame overlay */}
                <img
                  src={tabletFrameTransparent}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full z-10 pointer-events-none select-none"
                  style={{ filter: "drop-shadow(0 30px 70px rgba(0,0,0,0.45)) drop-shadow(0 10px 25px rgba(0,0,0,0.3))" }}
                />
              </div>
              {/* Format label */}
              <div className="w-full px-1 pt-3 flex items-center justify-between">
                <div>
                  <div className="text-white font-semibold text-sm">Horizontal</div>
                  <div className="text-white/60 text-xs">16:9</div>
                </div>
                <div className="text-white/50 text-[10px] font-bold tracking-widest uppercase">YOUTUBE</div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function ParallaxImageSection() {
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start end", "end start"]
  });
  const y = useTransform(scrollYProgress, [0, 1], ["-20%", "20%"]);

  return (
    <section ref={ref} className="relative h-[64vh] overflow-hidden">
      {/* Parallax video layer */}
      <motion.div
        style={{ y }}
        className="absolute inset-0 w-full h-[140%] -top-[20%]"
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          className="w-full h-full object-cover"
          aria-label="Materialized video banner"
        >
          <source src={mtrlzdVideoBanner} type="video/mp4" />
        </video>
      </motion.div>

      {/* Gradient overlays */}
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/70" />

      {/* Text overlay */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-4 text-center">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="text-[#6b8fd6] text-xs font-semibold tracking-[0.25em] uppercase mb-4"
        >
          Shopifying Creator Content
        </motion.p>
        <motion.p
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.25 }}
          className="text-white max-w-3xl text-center pl-[10px] pr-[10px] text-[24px]"
          style={{ fontFamily: "inherit" }}
        >
          Buy directly from{" "}
          <span
            className="inline-flex items-center overflow-hidden align-middle bg-[#6b8fd6]"
            style={{ borderRadius: 50, height: 44, width: 230, verticalAlign: "middle", position: "relative", top: -2 }}
          >
            <span
              className="pill-marquee-track font-accent text-white"
              style={{ fontStyle: "italic", fontSize: 18, whiteSpace: "nowrap", paddingLeft: 16 }}
            >
              creator content &nbsp;&nbsp;&nbsp;&nbsp; creator content &nbsp;&nbsp;&nbsp;&nbsp;
            </span>
          </span>
          , music videos, or film series
        </motion.p>
      </div>
    </section>
  );
}

function DataAnalyticsSection() {
  const [miroMuted, setMiroMuted] = useState(true);
  const miroVideoRef = useRef<HTMLVideoElement>(null);

  const chromeBlobs: Array<{
    size: number;
    anchor: { top?: string; bottom?: string; left?: string; right?: string };
    travelX: number[];
    travelY: number[];
    travelDuration: number;
    rotateDuration: number;
    dir: number;
  }> = [
    {
      size: 230,
      anchor: { top: "2%", left: "1%" },
      travelX: [0, 70, 40, -35, 20, 0],
      travelY: [0, 50, -40, 35, -22, 0],
      travelDuration: 42,
      rotateDuration: 18,
      dir: 1,
    },
    {
      size: 200,
      anchor: { bottom: "2%", right: "1%" },
      travelX: [0, -60, -32, 25, -15, 0],
      travelY: [0, -45, 35, -32, 18, 0],
      travelDuration: 52,
      rotateDuration: 24,
      dir: -1,
    },
    {
      size: 155,
      anchor: { bottom: "8%", left: "2%" },
      travelX: [0, 50, 28, -38, 12, 0],
      travelY: [0, -32, 28, 18, -18, 0],
      travelDuration: 34,
      rotateDuration: 14,
      dir: 1,
    },
    {
      size: 135,
      anchor: { top: "8%", right: "2%" },
      travelX: [0, -42, -22, 32, -8, 0],
      travelY: [0, 28, 48, -28, 12, 0],
      travelDuration: 40,
      rotateDuration: 16,
      dir: -1,
    },
    {
      size: 88,
      anchor: { top: "2%", left: "40%" },
      travelX: [0, 38, -28, 22, -10, 0],
      travelY: [0, 28, 42, 22, 10, 0],
      travelDuration: 26,
      rotateDuration: 10,
      dir: 1,
    },
  ];

  return (
    <section className="relative min-h-screen overflow-hidden bg-[#1a1a1a]">
      {/* Chrome blobs */}
      {chromeBlobs.map((blob, i) => (
        <motion.div
          key={i}
          animate={{ x: blob.travelX, y: blob.travelY }}
          transition={{ duration: blob.travelDuration, repeat: Infinity, ease: "easeInOut", repeatType: "loop" }}
          className="absolute pointer-events-none select-none"
          style={{ top: blob.anchor.top, bottom: blob.anchor.bottom, left: blob.anchor.left, right: blob.anchor.right, zIndex: 0 }}
        >
          <motion.img
            src={chromeBlobIcon}
            alt=""
            aria-hidden="true"
            animate={{ rotate: [0, blob.dir * 360] }}
            transition={{ duration: blob.rotateDuration, repeat: Infinity, ease: "linear" }}
            style={{ width: blob.size, height: blob.size, opacity: 0.14, display: "block" }}
          />
        </motion.div>
      ))}

      {/* Two-column content */}
      <div className="relative z-10 flex items-center min-h-screen px-6 pt-20 pb-12">
        <div className="max-w-6xl mx-auto w-full flex flex-col lg:flex-row items-center gap-10 lg:gap-20">

          {/* Left: Data Analytics text */}
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="flex-1 text-center lg:text-left"
          >
            <p className="text-[#6b8fd6] text-xs font-semibold tracking-[0.25em] uppercase mb-6">
              Data &amp; Analytics
            </p>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-white mb-6">
              <TypewriterText />
            </h2>
            <p className="text-lg md:text-xl text-white/70 max-w-xl mb-10">
              The all-in-one platform for creators, brands, and publishers to monetise video content with AI-powered product detection and seamless affiliate tracking.
            </p>
            <motion.div
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="inline-flex"
            >
              <Button
                onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}
                size="lg"
                className="text-white font-semibold rounded-full border-0"
                style={{ paddingLeft: "30px", paddingRight: "30px", paddingTop: "15px", paddingBottom: "15px", background: "#1351aa47", backdropFilter: "blur(8px)" }}
                data-testid="button-analytics-cta"
              >
                Try Now
              </Button>
            </motion.div>
          </motion.div>

          {/* Right: Miro Misljen product video in tablet */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.2 }}
            className="flex-1 flex justify-center overflow-hidden px-4 sm:px-0"
          >
            <div className="relative w-full max-w-[520px] mx-auto overflow-hidden">
              {/* Chrome tablet frame, rotated to vertical/portrait orientation, enlarged 1.5x */}
              <div
                className="relative mx-auto origin-top scale-[0.58] sm:scale-[0.78] lg:scale-100 -mb-[278px] sm:-mb-[146px] lg:mb-0"
                style={{ width: 450, height: 663 }}
              >
                {/* Frame graphic (landscape source image, rotated to appear portrait) */}
                <div
                  className="absolute top-1/2 left-1/2 pointer-events-none select-none"
                  style={{ width: 663, height: 450, transform: "translate(-50%, -50%) rotate(-90deg)" }}
                >
                  <img
                    src={chromeTabletFrame}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full"
                    style={{ objectFit: "fill", filter: "drop-shadow(0 50px 120px rgba(0,0,0,0.45)) drop-shadow(0 15px 40px rgba(0,0,0,0.3))" }}
                  />
                </div>
                {/* Video with product carousel fitted into the frame's screen area */}
                <div
                  className="absolute overflow-hidden bg-black"
                  style={{ left: "8.98%", top: "6.51%", width: "81.64%", height: "86.13%", borderRadius: 30 }}
                >
                  <button
                    onClick={() => {
                      const v = miroVideoRef.current;
                      if (!v) return;
                      const next = !miroMuted;
                      v.muted = next;
                      setMiroMuted(next);
                    }}
                    className="absolute top-3 left-3 z-30 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors backdrop-blur-sm"
                    data-testid="button-miro-audio-toggle"
                    title={miroMuted ? "Enable audio" : "Mute"}
                  >
                    {miroMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                  </button>
                  <video
                    ref={miroVideoRef}
                    src={miroMisljenDressVideo}
                    autoPlay
                    loop
                    playsInline
                    muted={miroMuted}
                    className="w-full h-full object-cover"
                    data-testid="video-miro-misljen"
                    onLoadedMetadata={(e) => {
                      const v = e.currentTarget;
                      v.currentTime = 3;
                      v.play().catch(() => {});
                    }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-br from-white/4 via-transparent to-transparent pointer-events-none" />
                  {/* Product carousel card, fitted inside the video/frame */}
                  <div className="absolute bottom-3 right-3 z-30">
                    <motion.div
                      animate={{ y: [0, -10, 0] }}
                      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                      <a
                        href="https://www.etsy.com/listing/4438945876/mixed-media-deconstructed-patchwork?ls=s&ga_order=most_relevant&ga_search_type=all&ga_view_type=gallery&ga_search_query=miro+misljen&ref=sr_gallery-1-7"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block no-underline"
                        style={{ width: "clamp(148px, 18vw, 196px)" }}
                        data-testid="link-miro-product-card"
                      >
                        <div
                          className="rounded-2xl overflow-hidden"
                          style={{
                            background: "rgba(0,0,0,0.52)",
                            backdropFilter: "blur(14px)",
                            border: "1px solid rgba(255,255,255,0.13)",
                            boxShadow: "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.06)",
                          }}
                        >
                          <div className="p-3 space-y-2.5">
                            <div className="space-y-0.5">
                              <div className="text-white/45 text-[7.5px] uppercase tracking-widest font-medium">MIRO MISLJEN</div>
                              <div className="text-white text-[11px] font-semibold leading-tight">Deconstructed Patchwork Dress</div>
                              <div className="text-white font-bold text-base leading-tight">{CURRENCY_SYMBOL}1,129</div>
                            </div>
                            <div
                              className="w-full text-center text-[8.5px] font-black tracking-widest text-[#1a1a1a] py-2 rounded-xl"
                              style={{ background: "rgba(255,255,255,0.92)" }}
                            >
                              BUY NOW
                            </div>
                          </div>
                        </div>
                      </a>
                    </motion.div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </div>
    </section>
  );
}

const ROLE_ROUTES: Record<string, string> = {
  creator: "/creator",
  brand: "/brand",
  publisher: "/affiliate",
};

/**
 * Landing-page plan copy.
 *
 * Prices are NOT written here — planPriceMajor() and setupFeeMajor() read
 * shared/plans.ts, the same catalogue server/stripeService.ts mints Stripe
 * prices from. That is deliberate: this page and the customer's card must never
 * disagree, and the product has already shipped two contradictory price lists
 * once.
 *
 * `role` is what the card click selects, so a visitor who picks a plan lands on
 * the right signup form rather than a generic one.
 */
const LANDING_PLANS: {
  id: PlanKey;
  role: "creator" | "brand" | "publisher";
  label: string;
  featured?: boolean;
  features: string[];
}[] = [
  {
    id: "creator",
    role: "creator",
    label: "Creator",
    featured: true,
    features: [
      "Upload and monetise 8 videos per month",
      "Tag brands for unlimited credits per month",
      "Publish shoppable videos to Substack, your website or your store",
      "Engage your audience through interactive storytelling",
      "Works with your existing affiliate commission partnerships",
      "Expand your reach by getting reposted on major websites",
      "Content discovery and reposts from the Global Video Library",
    ],
  },
  {
    id: "starter",
    role: "brand",
    label: "Brand",
    features: [
      "Make your product catalogue shoppable in creator videos",
      "Connect Shopify or WooCommerce and sync your inventory",
      "Campaigns with creators and publishers",
      "Attributed sales reporting",
      "Affiliate payouts ledger",
    ],
  },
  {
    id: "pro",
    role: "publisher",
    label: "Publisher",
    features: [
      "Repost from the Global Video Library at scale",
      "Affiliate commission on every attributed sale",
      "Unlimited embeds across your properties",
      "Advanced analytics and API access",
      "Priority support",
    ],
  },
];

function SignupSection() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedRole, setSelectedRole] = useState<"creator" | "brand" | "publisher" | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      role: "creator",
      firstName: "",
      surname: "",
      email: "",
      password: "",
      instagramHandle: "",
      tiktokHandle: "",
      country: "",
      city: "",
      accessCode: "",
    },
  });

  const mutation = useMutation({
    mutationFn: async (data: FormData) => {
      const backendRole = data.role === "publisher" ? "affiliate" : data.role;
      const response = await apiRequest("POST", "/api/auth/register", {
        email: data.email,
        password: data.password,
        displayName: `${data.firstName} ${data.surname}`.trim(),
        role: backendRole,
        accessCode: data.accessCode,
      });
      return response.json();
    },
    onSuccess: (_data, variables) => {
      toast({
        title: "Welcome aboard!",
        description: "Your account has been created successfully.",
      });
      const role = (variables.role || selectedRole) as string;
      const destination = ROLE_ROUTES[role] ?? "/creator";
      setLocation(destination);
    },
    onError: (error: Error) => {
      if (error.message.includes("409")) {
        form.setError("email", { message: "This email is already registered." });
        return;
      }
      toast({
        title: "Something went wrong",
        description: "Please try again later.",
        variant: "destructive",
      });
    },
  });

  const handleRoleSelect = (role: "creator" | "brand" | "publisher") => {
    setSelectedRole(role);
    form.setValue("role", role);
  };

  const onSubmit = (data: FormData) => {
    mutation.mutate(data);
  };

  return (
    <section id="signup" className="py-20 px-4 bg-[#33415c]">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl md:text-4xl font-bold text-center mb-4 text-white">
            Join the Revolution
          </h2>
          <p className="text-center text-white/70 mb-12 text-lg">
            Choose your subscription &amp; increase your sales performance
          </p>

          {!selectedRole ? (
            <div className="grid md:grid-cols-3 gap-6">
              {[
                {
                  role: "creator" as const,
                  title: "Creator",
                  tagline: "Built for Content Creators and Filmmakers",
                  hoverBg: "rgba(19,81,170,0.22)",
                  hoverBorder: "rgba(19,81,170,0.7)",
                  glowColor: "rgba(19,81,170,0.35)",
                },
                {
                  role: "brand" as const,
                  title: "Brand",
                  tagline: "Designed for Brands and eCommerce Stores",
                  hoverBg: "rgba(49,77,59,0.28)",
                  hoverBorder: "rgba(109,191,126,0.7)",
                  glowColor: "rgba(107,143,214,0.3)",
                },
                {
                  role: "publisher" as const,
                  title: "Publisher",
                  tagline: "Affiliate benefits for Publishers who repost from the Global Video Library",
                  hoverBg: "rgba(200,165,74,0.2)",
                  hoverBorder: "rgba(200,165,74,0.65)",
                  glowColor: "rgba(2,4,16,0.35)",
                },
              ].map((item) => (
                <motion.button
                  key={item.role}
                  initial={{ boxShadow: "0 0 0px transparent" }}
                  whileHover={{
                    scale: 1.04,
                    backgroundColor: item.hoverBg,
                    borderColor: item.hoverBorder,
                    boxShadow: `0 8px 40px ${item.glowColor}, 0 0 0 1px ${item.hoverBorder}`,
                  }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  onClick={() => handleRoleSelect(item.role)}
                  className="p-8 rounded-3xl backdrop-blur-sm text-left flex flex-col gap-5 group"
                  style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)", minHeight: 220 }}
                  data-testid={`button-role-${item.role}`}
                >
                  <div>
                    <div className="text-2xl font-bold text-white mb-3 tracking-tight" style={{ fontFamily: "'Aileron', sans-serif" }}>
                      {item.title}
                    </div>
                    <div className="text-white/75 text-base leading-relaxed">{item.tagline}</div>
                  </div>
                  <div className="mt-auto text-sm font-semibold flex items-center gap-1.5 text-white">
                    Get started
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </motion.button>
              ))}
            </div>
          ) : (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
            >
              <button
                onClick={() => setSelectedRole(null)}
                className="text-white/60 hover:text-white mb-6 flex items-center gap-2"
                data-testid="button-back-role"
              >
                <ChevronDown className="w-4 h-4 rotate-90" />
                Back to role selection
              </button>
              <Card className="bg-white/10 backdrop-blur-sm border-white/20 p-6" style={{ borderRadius: 50 }}>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">First Name</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                                placeholder="John"
                                data-testid="input-first-name"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="surname"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">Surname</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                                placeholder="Doe"
                                data-testid="input-surname"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">Password</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                              placeholder="Min. 6 characters"
                              data-testid="input-password"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">Email</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                              placeholder="john@example.com"
                              data-testid="input-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="instagramHandle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">Instagram (optional)</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ""}
                                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                                placeholder="@yourhandle"
                                data-testid="input-instagram"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="tiktokHandle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">TikTok (optional)</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                value={field.value || ""}
                                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                                placeholder="@yourhandle"
                                data-testid="input-tiktok"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="country"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">Country</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                              <FormControl>
                                <SelectTrigger className="bg-white/10 border-white/20 text-white" data-testid="select-country">
                                  <SelectValue placeholder="Select country" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent className="max-h-[200px]">
                                {COUNTRIES.map((country) => (
                                  <SelectItem key={country} value={country}>
                                    {country}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="text-white">City</FormLabel>
                            <FormControl>
                              <Input
                                {...field}
                                className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                                placeholder="New York"
                                data-testid="input-city"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="accessCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-white">Voucher Code <span className="text-white/50 font-normal text-xs">If you have a voucher code, enter it here</span></FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              className="bg-white/10 border-white/20 text-white placeholder:text-white/40"
                              placeholder="Enter your voucher code"
                              data-testid="input-access-code"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      disabled={mutation.isPending}
                      className="w-full bg-[#1351aa] hover:bg-[#0f4189] text-white font-semibold py-6 rounded-full mt-6"
                      style={{ paddingLeft: "30px", paddingRight: "30px" }}
                      data-testid="button-submit-signup"
                    >
                      {mutation.isPending ? "Creating Account..." : "Create Account"}
                    </Button>
                  </form>
                </Form>
              </Card>
            </motion.div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

function RollingText({ children }: { children: string }) {
  return (
    <span
      className="relative inline-flex flex-col overflow-hidden"
      style={{ height: "1.2em", verticalAlign: "bottom" }}
    >
      <span
        className="translate-y-0 transition-transform duration-500 ease-in-out group-hover:-translate-y-full"
        aria-hidden="true"
      >
        {children}
      </span>
      <span
        className="absolute inset-x-0 translate-y-full transition-transform duration-500 ease-in-out group-hover:translate-y-0"
      >
        {children}
      </span>
    </span>
  );
}

export default function Landing() {
  const [openFooterItem, setOpenFooterItem] = useState<string | null>(null);
  const [showDemo, setShowDemo] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [headerScrolled, setHeaderScrolled] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      setHeaderScrolled(currentY > 20);
      if (currentY < 10) {
        setHeaderVisible(true);
      } else if (currentY > lastScrollY.current + 4) {
        setHeaderVisible(false);
      } else if (currentY < lastScrollY.current - 4) {
        setHeaderVisible(true);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToSignup = () => {
    document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" });
  };

  // Page background is near-black in both themes and matched to the footer
  // exactly: the footer and the analytics card above it are rounded, so any
  // lighter page background shows through the corners as a band.
  return (
    <div className="min-h-screen bg-[#020410]">
      <section className="relative min-h-screen overflow-hidden">
        <video
          autoPlay
          loop
          muted
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
          aria-label="Miro Misljen black dress fashion video"
        >
          <source src={videoDeliveryUrl("https://res.cloudinary.com/dvj7ayoot/video/upload/v1784819059/materialized/landing/miro-misljen-black-dress.mp4", "player")} type="video/mp4" />
        </video>
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/25 to-black/70" />

        {/* Nav bar — hides on scroll-down, reveals on scroll-up */}
        <div
          className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center sm:justify-between px-4 sm:px-6 py-3 sm:py-4 transition-transform duration-300 ease-in-out"
          style={{
            transform: headerVisible ? "translateY(0)" : "translateY(-100%)",
            background: headerScrolled
              ? "linear-gradient(to bottom, rgba(10,10,10,0.88) 0%, rgba(10,10,10,0.72) 60%, rgba(10,10,10,0) 100%)"
              : "linear-gradient(to bottom, rgba(10,10,10,0.70) 0%, rgba(10,10,10,0.40) 60%, rgba(10,10,10,0) 100%)",
          }}
        >
          <img src={materializedLogo} alt="Materialized" className="h-20 sm:h-32 w-auto" />
          <div className="hidden sm:flex items-center gap-3">
            <Link href="/login">
              <Button
                variant="ghost"
                size="sm"
                className="group text-white/80 hover:text-white rounded-full text-sm overflow-hidden flex items-center gap-1.5"
                style={{ border: "1px solid rgba(180,180,180,0.32)", background: "transparent" }}
                data-testid="button-nav-signin"
              >
                <CircleUserRound className="w-4 h-4 shrink-0" strokeWidth={1.5} />
                <RollingText>Sign In</RollingText>
              </Button>
            </Link>
            <Button
              onClick={scrollToSignup}
              variant="ghost"
              size="sm"
              className="group text-white font-semibold rounded-full text-sm overflow-hidden"
              style={{ border: "1px solid rgba(180,180,180,0.32)", background: "transparent" }}
              data-testid="button-nav-get-started"
            >
              <RollingText>Get Started</RollingText>
            </Button>
          </div>
        </div>

        {/* Hero text — bottom left */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9 }}
          className="relative z-10 flex flex-col justify-end min-h-screen px-6 sm:px-10 pb-20 pt-24"
        >
          <p className="text-[#6b8fd6] text-xs font-semibold tracking-[0.25em] uppercase mb-4">
            Shoppable Creator Content
          </p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-bold text-white leading-tight mb-6 max-w-2xl">
            Turn Video<br />Into Revenue
          </h1>
          <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            transition={{ type: "spring", stiffness: 300, damping: 18 }}
            className="inline-flex"
          >
            <Button
              onClick={scrollToSignup}
              size="lg"
              className="text-white font-semibold rounded-full border-0"
              style={{ paddingLeft: "30px", paddingRight: "30px", paddingTop: "15px", paddingBottom: "15px", background: "rgba(255,255,255,0.15)", backdropFilter: "blur(10px)", border: "1px solid rgba(255,255,255,0.25)" }}
              data-testid="button-hero-cta"
            >
              Get Started
            </Button>
          </motion.div>
        </motion.div>

        {/* Floating Miro Misljen product card */}
        <div className="absolute top-24 right-4 sm:top-auto sm:bottom-16 sm:right-6 z-30" style={{ width: "clamp(160px, 26vw, 260px)" }}>
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
          >
            <a
              href="https://www.etsy.com/listing/4438945876/mixed-media-deconstructed-patchwork?ls=s&ga_order=most_relevant&ga_search_type=all&ga_view_type=gallery&ga_search_query=miro+misljen&ref=sr_gallery-1-7"
              target="_blank"
              rel="noopener noreferrer"
              className="block no-underline"
              data-testid="card-miro-black-dress-hero"
            >
              <div
                className="rounded-3xl overflow-hidden"
                style={{
                  background: "rgba(0,0,0,0.58)",
                  backdropFilter: "blur(14px)",
                  border: "1px solid rgba(255,255,255,0.13)",
                  boxShadow: "0 24px 60px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.06)",
                  padding: "18px",
                }}
              >
                <div className="space-y-1 mb-4">
                  <div className="text-white/45 text-[8px] uppercase tracking-widest font-medium">MIRO MISLJEN</div>
                  <div className="text-white text-sm font-semibold leading-tight">Deconstructed Patchwork Dress</div>
                  <div className="text-white font-bold text-xl leading-tight">{CURRENCY_SYMBOL}1,129</div>
                </div>
                <div
                  className="w-full text-center text-[9px] font-black tracking-widest text-[#1a1a1a] py-2.5 rounded-2xl"
                  style={{ background: "rgba(255,255,255,0.92)" }}
                >
                  BUY NOW
                </div>
              </div>
            </a>
          </motion.div>
        </div>

        {/* Scroll chevron */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2, duration: 1 }}
          className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10"
        >
          <ChevronDown className="w-8 h-8 text-white/50 animate-bounce" />
        </motion.div>
      </section>

      {/* Mobile-only submenu — below hero video */}
      <div className="sm:hidden bg-[#020410] px-4 py-3 flex items-center justify-between gap-2">
        <button
          onClick={() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth" })}
          data-testid="button-mobile-pricing"
          className="flex-1 py-2 px-3 rounded-xl text-white/60 text-sm font-medium transition-colors hover:text-white"
          style={{ background: "transparent" }}
        >
          Pricing
        </button>
        <div className="w-px h-5 bg-white/15 flex-shrink-0" />
        <Link href="/login">
          <button
            className="flex items-center gap-1.5 py-2 px-3 rounded-xl text-white/60 text-sm font-medium transition-colors hover:text-white flex-shrink-0"
            style={{ background: "transparent" }}
            data-testid="button-mobile-signin"
          >
            <CircleUserRound className="w-4 h-4 shrink-0" strokeWidth={1.5} />
            Sign In
          </button>
        </Link>
      </div>

      {/* Section cards — float on #020410 background with 50px radius */}
      <div className="bg-[#020410] px-3 md:px-6 space-y-3 py-3">

      <div
        className="overflow-hidden"
        style={{ borderRadius: 50, boxShadow: "0 20px 70px rgba(0,0,0,0.55), 0 6px 20px rgba(0,0,0,0.3)" }}
      >
        <StatsSection />
        <TestimonialCarousel />
      </div>

      {/* Parallax video — full-bleed, breaks out of the card padding */}
      <div className="overflow-hidden -mx-3 md:-mx-6">
        <ParallaxImageSection />
      </div>

      <div
        className="overflow-hidden relative"
        style={{ borderRadius: 50, boxShadow: "0 20px 70px rgba(0,0,0,0.55), 0 6px 20px rgba(0,0,0,0.3)", background: "#001233", marginTop: -48, zIndex: 10 }}
      >
        <VideoOrientationSection />
      </div>

      {/* Announcement marquee bar */}
      {(() => {
        const items = [
          "documentaries",
          "music videos",
          "beauty tutorials",
          "panels and stage performances",
          "theatre productions",
          "advertorials",
          "fashion runways",
          "in-flight entertainment",
          "travel blogs",
          "fashion week",
          "creator content",
        ];
        const pillText = "creator content  •  creator content  •  creator content  •  creator content  •  ";
        const renderTrack = (prefix: string) =>
          items.map((item, i) =>
            item === "creator content" ? (
              <span key={`${prefix}-${i}`} className="flex items-center shrink-0 px-3">
                <span
                  className="inline-flex items-center overflow-hidden shrink-0 bg-[#6b8fd6]"
                  style={{ borderRadius: 50, height: 44, width: 220, verticalAlign: "middle" }}
                >
                  <span className="pill-marquee-track">
                    <span className="whitespace-nowrap px-4 font-accent text-white" style={{ fontStyle: "italic", fontSize: 18, letterSpacing: "0.01em" }}>
                      {pillText}
                    </span>
                    <span className="whitespace-nowrap px-4 font-accent text-white" style={{ fontStyle: "italic", fontSize: 18, letterSpacing: "0.01em" }}>
                      {pillText}
                    </span>
                  </span>
                </span>
              </span>
            ) : (
              <span key={`${prefix}-${i}`} className="flex items-center shrink-0">
                <span className="whitespace-nowrap text-white text-sm font-medium tracking-wide uppercase px-4">
                  {item}
                </span>
                <img
                  src="/blob-divider.png"
                  alt=""
                  aria-hidden="true"
                  className={`shrink-0${i % 2 === 1 ? " blob-spin-ccw" : ""}`}
                  style={{ width: 28, height: 28, objectFit: "contain" }}
                />
              </span>
            )
          );
        return (
          <div className="w-full overflow-hidden bg-[#020410] py-4">
            <div className="marquee-track">
              {renderTrack("a")}
              {renderTrack("b")}
            </div>
          </div>
        );
      })()}

      {/*
        Pricing. Amounts come from shared/plans.ts — the same catalogue the server
        mints Stripe prices from — so the page can never advertise a number
        different from the one a customer is charged. The feature copy lives here
        because it is marketing text, not a billing fact.
      */}
      <section id="pricing" className="py-20 px-4 bg-[#020410]">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-4">
            <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight" style={{ fontFamily: "'Aileron', sans-serif" }}>
              Subscription Plans
            </h2>
            <p className="text-white/60 mt-3 text-sm sm:text-base">
              All plans include a one-time {CURRENCY_SYMBOL}{setupFeeMajor()} admin setup fee
              {" · "}{PLAN_ALLOWANCES.creator.views.toLocaleString()} views included
              {" · "}{CURRENCY_SYMBOL}{OVERAGE_RATES.perView.toFixed(3)}/view after that
            </p>
            <p className="text-white/40 mt-2 text-xs">
              All prices in {PLATFORM_CURRENCY_CODE}. Billed monthly, cancel any time.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-6 mt-12">
            {LANDING_PLANS.map((plan) => (
              <button
                key={plan.id}
                /*
                  Scrolls to the signup section rather than calling
                  handleRoleSelect — that function lives inside SignupSection and
                  is NOT in scope here, so calling it threw a ReferenceError on
                  every click. tsc caught it (TS2304); `npm run build` did not,
                  because vite bundles without typechecking, so it shipped.
                */
                onClick={() => document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" })}
                data-testid={`card-pricing-${plan.id}`}
                className={`text-left p-8 rounded-3xl backdrop-blur-sm flex flex-col transition-all hover:scale-[1.02] ${
                  plan.featured ? "ring-1 ring-white/40" : ""
                }`}
                style={{ background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.15)" }}
              >
                <div className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: "'Aileron', sans-serif" }}>
                  {plan.label}
                </div>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold text-white">{CURRENCY_SYMBOL}{planPriceMajor(plan.id)}</span>
                  <span className="text-white/60 text-sm">/month</span>
                </div>
                <div className="text-white/45 text-xs mt-2">
                  + {CURRENCY_SYMBOL}{setupFeeMajor()} one-time setup fee + overage
                </div>

                <div className="h-px bg-white/15 my-6" />

                <ul className="space-y-3 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2.5 text-white/80 text-sm leading-relaxed">
                      <Check className="w-4 h-4 mt-0.5 shrink-0 text-[#6b8fd6]" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <div className="mt-8 text-sm font-semibold flex items-center gap-1.5 text-white">
                  Get started
                  <ArrowRight className="w-4 h-4" />
                </div>
              </button>
            ))}
          </div>

          {/*
            The estimator, in front of prospects rather than behind a login.
            It previously existed only inside the two subscription settings
            pages — and the creator one was gated on !isOnTrial, so the people
            deciding whether to sign up were precisely the ones who could not
            see what it would cost them.
          */}
          <div className="mt-10 max-w-xl mx-auto">
            <PricingEstimator
              plan="creator"
              selectablePlans={["creator", "starter", "pro"]}
              title="What would a month cost?"
              className="bg-white/[0.04] border-white/10 text-white [&_p]:text-white/60 [&_label]:text-white"
            />
          </div>
        </div>
      </section>

      <div
        className="overflow-hidden"
        style={{ borderRadius: 50, boxShadow: "0 20px 70px rgba(0,0,0,0.55), 0 6px 20px rgba(0,0,0,0.3)" }}
      >
        <SignupSection />
      </div>

      <div
        className="overflow-hidden relative"
        style={{ borderRadius: 50, background: "#1a1a1a", boxShadow: "0 20px 70px rgba(0,0,0,0.55), 0 6px 20px rgba(0,0,0,0.3)" }}
      >
        <DataAnalyticsSection />
      </div>

      </div>

      <DemoPopup open={showDemo} onClose={() => setShowDemo(false)} />

      <footer
        className="py-12 px-4 border-t border-white/10 bg-[#020410]"
        style={{ borderTopLeftRadius: 50, borderTopRightRadius: 50, marginTop: -15, position: "relative", zIndex: 10 }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-8">
            <img src={materializedLogo} alt="Materialized" className="h-40 mx-auto" />
          </div>

          <div className="max-w-md mx-auto mb-8 space-y-1">
            {[
              {
                key: "support",
                label: "Support",
                content: (
                  <div className="text-white/60 text-sm leading-relaxed">
                    <p className="mb-3">Need help? Visit our Help Centre for guides and FAQs, or browse the Creator, Brand, and Publisher dashboards to get started.</p>
                    <div className="flex flex-wrap gap-3 mb-3">
                      <Link href="/creator" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-creator">Creator Portal</Link>
                      <Link href="/brand" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-brand">Brand Portal</Link>
                      <Link href="/affiliate" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-publisher">Publisher Portal</Link>
                    </div>
                    <p>Not registered yet? <a href="#signup" onClick={(e) => { e.preventDefault(); document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" }); }} className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-support-signup">Sign Up &rarr;</a> to access full support resources.</p>
                  </div>
                ),
              },
              {
                key: "integrations",
                label: "Integrations",
                content: (
                  <div className="text-white/60 text-sm leading-relaxed">
                    <p className="mb-3">Shoppable videos are exported as embedded code, which can be published on any website or platform. UTM codes provide video performance analytics, and reward the affiliate eco-system. API Keys are used to sync product inventories, that in turn make video imports shoppable.</p>
                    <div className="flex flex-wrap gap-3 mb-3">
                      <Link href="/creator" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-integrations-creator">Creator Portal</Link>
                      <Link href="/brand" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-integrations-brand">Brand Portal</Link>
                      <Link href="/affiliate" className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-integrations-publisher">Publisher Portal</Link>
                    </div>
                    <p>Ready to connect? <a href="#signup" onClick={(e) => { e.preventDefault(); document.getElementById("signup")?.scrollIntoView({ behavior: "smooth" }); }} className="text-[#1351aa] hover:text-[#4a7ed6] underline" data-testid="link-footer-integrations-signup">Sign Up &rarr;</a> to get started.</p>
                  </div>
                ),
              },
              {
                key: "contact",
                label: "Contact",
                content: <ContactForm />,
              },
            ].map((item) => (
              <div key={item.key} className="border-b border-white/10">
                <button
                  onClick={() => setOpenFooterItem(openFooterItem === item.key ? null : item.key)}
                  className="w-full flex items-center justify-between py-3 text-white text-sm font-medium hover:text-[#1351aa] transition-colors"
                  data-testid={`button-footer-${item.key}`}
                >
                  {item.label}
                  <ChevronDown className={`w-4 h-4 transition-transform duration-300 ${openFooterItem === item.key ? "rotate-180" : ""}`} />
                </button>
                <div className={`overflow-hidden transition-all duration-300 ${openFooterItem === item.key ? (item.key === "contact" ? "max-h-[700px] pb-4" : "max-h-60 pb-4") : "max-h-0"}`}>
                  {item.content}
                </div>
              </div>
            ))}

            {/* Demo — opens video popup */}
            <div className="border-b border-white/10">
              <button
                onClick={() => setShowDemo(true)}
                className="w-full flex items-center justify-between py-3 text-white text-sm font-medium hover:text-[#1351aa] transition-colors"
                data-testid="button-footer-demo"
              >
                Demo
                <Play className="w-4 h-4 text-[#1351aa]" />
              </button>
            </div>
          </div>

          <div className="flex justify-center gap-4 mb-4">
            <a
              href="https://instagram.com/join.materialized"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Materialized on Instagram"
              data-testid="link-footer-instagram"
              className="text-white/60 hover:text-white transition-colors"
            >
              <SiInstagram className="w-5 h-5" />
            </a>
            <a
              href="https://www.linkedin.com/showcase/join-materialized/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Materialized on LinkedIn"
              data-testid="link-footer-linkedin"
              className="text-white/60 hover:text-white transition-colors"
            >
              <SiLinkedin className="w-5 h-5" />
            </a>
          </div>

          <div className="flex flex-wrap justify-center items-center gap-x-4 gap-y-2 mb-3">
            <Link
              href="/privacy"
              className="text-white/40 hover:text-white text-xs transition-colors"
              data-testid="link-footer-privacy"
            >
              Privacy Policy
            </Link>
            <span className="text-white/20 text-xs" aria-hidden="true">&middot;</span>
            <Link
              href="/cookies"
              className="text-white/40 hover:text-white text-xs transition-colors"
              data-testid="link-footer-cookies"
            >
              Cookie Policy
            </Link>
          </div>

          <p className="text-white/40 text-xs text-center" data-testid="text-footer-copyright">
            &copy; 2026 Materialized. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
