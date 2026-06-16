import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  ArrowUpRight,
  UploadSimple,
  UsersThree,
  FunnelSimple,
  Eye,
  Shuffle,
  Sliders,
  Lightning,
  ShieldCheck,
  EnvelopeSimple,
  DiscordLogo,
  XLogo,
} from "@phosphor-icons/react";
import { useAuth } from "../context/AuthContext";

const NFTS = [
  "/nft/nft1.png",
  "/nft/nft2.png",
  "/nft/nft3.png",
  "/nft/nft4.png",
  "/nft/nft5.png",
  "/nft/nft6.jpg",
  "/nft/nft7.jpg",
  "/nft/nft8.png",
  "/nft/nft9.jpeg",
  "/nft/nft10.webp",
  "/nft/nft11.webp",
  "/nft/nft12.webp",
  "/nft/nft13.webp",
];

const COLUMNS = [
  { items: [NFTS[0], NFTS[3], NFTS[6], NFTS[12]], anim: "marquee-down" },
  { items: [NFTS[2], NFTS[8], NFTS[9], NFTS[11]], anim: "marquee-up" },
  { items: [NFTS[1], NFTS[4], NFTS[7], NFTS[10]], anim: "marquee-down" },
];

function NftCard({ src }) {
  return (
    <div className="bezel-outer">
      <div className="bezel-inner overflow-hidden aspect-square">
        <img
          src={src}
          alt="MultiversX NFT collection artwork"
          loading="lazy"
          className="w-full h-full object-cover"
        />
      </div>
    </div>
  );
}

function NftWall() {
  return (
    <div className="collage-mask relative h-[520px] lg:h-[640px] overflow-hidden">
      <div className="grid grid-cols-3 gap-3.5 h-full">
        {COLUMNS.map((col, i) => (
          <div
            key={i}
            className={`marquee-col ${col.anim} ${i === 1 ? "mt-[-3rem]" : ""}`}
          >
            {[...col.items, ...col.items].map((src, j) => (
              <NftCard key={`${i}-${j}`} src={src} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const FEATURES = [
  {
    icon: UploadSimple,
    title: "Effortless layer uploads",
    body: "Drag and drop your entire layers folder. We parse rarity weights, validate filenames and sync every trait automatically — no config files to hand-edit.",
    span: "lg:col-span-2",
  },
  {
    icon: UsersThree,
    title: "Multi-character collections",
    body: "Build collections with multiple base characters or body types, each with their own trait sets, all from a single project.",
    span: "lg:col-span-2",
  },
  {
    icon: Eye,
    title: "Instant live previews",
    body: "Shuffle and preview real trait combinations in real time before you generate a single edition.",
    span: "lg:col-span-2",
  },
  {
    icon: FunnelSimple,
    title: "Trait filters & matrix",
    body: "Browse every layer and element in a visual matrix. Filter, toggle and fine-tune trait availability with a click.",
    span: "lg:col-span-3",
  },
  {
    icon: Shuffle,
    title: "Rule-based generation",
    body: "Define incompatibilities and exclusions so conflicting traits never appear together — proven layer-restriction logic built into the generator.",
    span: "lg:col-span-3",
  },
  {
    icon: Sliders,
    title: "Rarity weighting",
    body: "Tune the drop rate of every trait to engineer the exact rarity curve your collection needs.",
    span: "lg:col-span-2",
  },
  {
    icon: Lightning,
    title: "Batch generate & export",
    body: "Render unique editions with metadata at scale, then export a collection that's ready to mint.",
    span: "lg:col-span-2",
  },
  {
    icon: ShieldCheck,
    title: "MultiversX wallet auth",
    body: "Sign in with your MultiversX wallet. Every project stays private and tied to your account.",
    span: "lg:col-span-2",
  },
];

const SOCIALS = [
  {
    icon: EnvelopeSimple,
    label: "hodl.token.club@gmail.com",
    href: "mailto:hodl.token.club@gmail.com",
  },
  {
    icon: DiscordLogo,
    label: "Join our Discord",
    href: "https://discord.gg/qZTkKbjnke",
  },
  {
    icon: XLogo,
    label: "@HodlTokenClub",
    href: "https://x.com/HodlTokenClub",
  },
];

export default function Landing() {
  const { isAuthenticated, connectWallet } = useAuth();
  const reduce = useReducedMotion();

  const fadeUp = {
    initial: reduce ? false : { opacity: 0, y: 24, filter: "blur(6px)" },
    whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
    viewport: { once: true, amount: 0.3 },
  };

  return (
    <div className="hodl-mesh min-h-[100dvh]">
      {/* HERO */}
      <section className="max-w-7xl mx-auto px-4 pt-32 pb-20 lg:pt-36 lg:pb-28">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="inline-flex items-center gap-2 rounded-full gold-ring bg-white/[0.03] px-3 py-1">
              <img
                src="/brand/hodl-logo.png"
                alt=""
                className="w-4 h-4 rounded-full object-cover"
              />
              <span className="text-[10px] uppercase tracking-[0.2em] font-medium text-amber-200/80">
                By HODL Token Club
              </span>
            </div>

            <h1 className="mt-6 text-4xl md:text-5xl lg:text-[3.75rem] font-semibold tracking-tighter leading-[0.95] text-white">
              The artwork generator for{" "}
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-amber-200 bg-clip-text text-transparent">
                MultiversX
              </span>{" "}
              collections
            </h1>

            <p className="mt-6 text-base md:text-lg text-zinc-400 leading-relaxed max-w-[60ch]">
              Upload layered artwork, build multi-character collections, filter
              traits, preview combinations instantly and batch-generate
              thousands of unique editions — all in one studio, no code required.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
                >
                  Open Studio
                  <span className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform">
                    <ArrowRight size={16} weight="bold" />
                  </span>
                </Link>
              ) : (
                <button
                  onClick={connectWallet}
                  className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-6 py-3 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
                >
                  Connect Wallet
                  <span className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform">
                    <ArrowRight size={16} weight="bold" />
                  </span>
                </button>
              )}
              <a
                href="#features"
                className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-6 py-3 text-sm font-medium text-zinc-300 hover:bg-white/[0.06] hover:text-white transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
              >
                Explore features
              </a>
            </div>

            <div className="mt-10 flex items-center gap-5">
              <div className="flex items-center gap-2.5">
                <img
                  src="/brand/multiversx.webp"
                  alt="MultiversX"
                  className="w-6 h-6 rounded-md object-contain"
                />
                <span className="text-xs text-zinc-500">
                  Built for the MultiversX ecosystem
                </span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={reduce ? false : { opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.8, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="relative"
          >
            <NftWall />
            <p className="mt-4 text-center text-[11px] uppercase tracking-[0.18em] text-zinc-600">
              Featuring top MultiversX collections
            </p>
          </motion.div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="max-w-7xl mx-auto px-4 py-24 scroll-mt-24">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-2xl"
        >
          <span className="inline-block rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-medium text-emerald-400">
            Everything you need
          </span>
          <h2 className="mt-5 text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tighter leading-[1.02] text-white">
            From raw layers to a mint-ready collection
          </h2>
          <p className="mt-4 text-base text-zinc-400 leading-relaxed">
            A focused, professional toolkit that turns your artwork into a fully
            generated NFT collection — fast, precise and entirely in your
            control.
          </p>
        </motion.div>

        <div className="mt-12 grid lg:grid-cols-6 gap-5">
          {FEATURES.map((item, i) => (
            <motion.div
              key={item.title}
              initial={reduce ? false : { opacity: 0, y: 16, filter: "blur(6px)" }}
              whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              viewport={{ once: true, amount: 0.3 }}
              transition={{
                duration: 0.6,
                delay: i * 0.05,
                ease: [0.16, 1, 0.3, 1],
              }}
              className={`bezel-outer ${item.span}`}
            >
              <div className="bezel-inner p-7 h-full flex flex-col">
                <span className="w-11 h-11 rounded-full bg-emerald-500/10 ring-1 ring-emerald-500/20 flex items-center justify-center mb-5">
                  <item.icon size={22} weight="light" className="text-emerald-400" />
                </span>
                <h3 className="text-lg font-semibold text-white">{item.title}</h3>
                <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
                  {item.body}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA BAND */}
      <section className="max-w-7xl mx-auto px-4 pb-24">
        <motion.div
          {...fadeUp}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="bezel-outer"
        >
          <div className="bezel-inner relative overflow-hidden px-8 py-16 md:px-16 md:py-20 text-center">
            <div className="absolute inset-0 hodl-mesh opacity-60 pointer-events-none" />
            <div className="relative">
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tighter text-white max-w-2xl mx-auto leading-[1.05]">
                Ready to generate your next MultiversX drop?
              </h2>
              <p className="mt-4 text-zinc-400 max-w-xl mx-auto">
                Connect your wallet and launch the studio in seconds.
              </p>
              <div className="mt-8 flex justify-center">
                {isAuthenticated ? (
                  <Link
                    to="/dashboard"
                    className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-7 py-3.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
                  >
                    Open Studio
                    <span className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform">
                      <ArrowRight size={16} weight="bold" />
                    </span>
                  </Link>
                ) : (
                  <button
                    onClick={connectWallet}
                    className="group inline-flex items-center gap-2 rounded-full bg-emerald-500 px-7 py-3.5 text-sm font-medium text-zinc-950 hover:bg-emerald-400 transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.98]"
                  >
                    Connect Wallet
                    <span className="w-8 h-8 rounded-full bg-black/10 flex items-center justify-center group-hover:translate-x-0.5 group-hover:-translate-y-px transition-transform">
                      <ArrowRight size={16} weight="bold" />
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-white/5">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <div className="grid md:grid-cols-[1.4fr_1fr] gap-12">
            <div>
              <div className="flex items-center gap-3">
                <img
                  src="/brand/hodl-logo.png"
                  alt="HODL Token Club"
                  className="w-10 h-10 rounded-full ring-1 ring-white/10 object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-white leading-tight">
                    HODL Artwork Generator
                  </p>
                  <p className="text-xs text-zinc-500">by HODL Token Club</p>
                </div>
              </div>
              <p className="mt-5 text-sm text-zinc-400 leading-relaxed max-w-md">
                A premium NFT collection generator crafted by HODL Token Club for
                creators building on MultiversX.
              </p>
              <div className="mt-6 flex items-center gap-3">
                <img
                  src="/brand/multiversx.webp"
                  alt="MultiversX"
                  className="w-5 h-5 rounded object-contain"
                />
                <span className="text-xs text-zinc-500">
                  Powered by MultiversX
                </span>
              </div>
            </div>

            <div>
              <h3 className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-medium">
                Get in touch
              </h3>
              <ul className="mt-5 space-y-3">
                {SOCIALS.map((s) => (
                  <li key={s.label}>
                    <a
                      href={s.href}
                      target={s.href.startsWith("http") ? "_blank" : undefined}
                      rel={
                        s.href.startsWith("http")
                          ? "noopener noreferrer"
                          : undefined
                      }
                      className="group inline-flex items-center gap-3 text-sm text-zinc-400 hover:text-white transition-colors duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
                    >
                      <span className="w-9 h-9 rounded-full bg-white/[0.04] ring-1 ring-white/10 flex items-center justify-center group-hover:bg-emerald-500/10 group-hover:ring-emerald-500/25 transition-colors">
                        <s.icon size={17} weight="light" className="text-zinc-300 group-hover:text-emerald-400 transition-colors" />
                      </span>
                      {s.label}
                      <ArrowUpRight
                        size={14}
                        className="opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 text-zinc-500"
                      />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-14 pt-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-zinc-600">
              © {new Date().getFullYear()} HODL Token Club. All rights reserved.
            </p>
            <p className="text-xs text-zinc-600 text-center sm:text-right">
              Built for MultiversX creators. Inspired by the open-source{" "}
              <a
                href="https://github.com/HashLips/hashlips_art_engine"
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-zinc-400 underline underline-offset-2"
              >
                HashLips Art Engine
              </a>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
