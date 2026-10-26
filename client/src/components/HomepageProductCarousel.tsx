import { motion, useReducedMotion } from "framer-motion";

/** The homepage's existing product carousel card, shared without a visual redesign. */
export function HomepageProductCarousel() {
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      animate={reducedMotion ? { y: 0 } : { y: [0, -10, 0] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
    >
      <a
        href="https://www.etsy.com/listing/4454443883/one-shoulder-black-dress-one-size-34-to?ref=shop_home_active_14&frs=1&logging_key=b2c6b649fb5b9c4ad8cea5cc9f68f260b736d7a4%3A4454443883"
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
            <div className="text-white text-sm font-semibold leading-tight">Little Black Dress</div>
            <div className="text-white font-bold text-xl leading-tight">€790</div>
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
  );
}
