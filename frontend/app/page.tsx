"use client";

import { motion, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { ArrowRight, CheckCircle, Clock, Coins, Database, Layers } from "lucide-react";
import Link from "next/link";

import { usePreferences } from "@/components/preferences-provider";

/* ---------------------------------------------------------
 * LANDING CONTENT STORYBOARD
 *
 *    0ms   shell is interactive immediately
 *   80ms   eyebrow fades in
 *  180ms   headline lines reveal upward
 *  420ms   supporting copy and CTAs settle in
 *  scroll  token path draws down the page
 *  scroll  cards receive short stream sweeps
 *  scroll  audit timeline fills with progress
 * --------------------------------------------------------- */

const SPRING = { type: "spring" as const, stiffness: 320, damping: 30 };
const CARD_STAGGER = 0.06;

const sectionReveal = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0 }
};

function MotionSection({
  children,
  className = ""
}: Readonly<{ children: React.ReactNode; className?: string }>) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.section
      className={className}
      initial={reduceMotion ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, margin: "-80px" }}
      variants={sectionReveal}
      transition={reduceMotion ? { duration: 0 } : SPRING}
    >
      {children}
    </motion.section>
  );
}

function AnimatedWords({ text }: Readonly<{ text: string }>) {
  const reduceMotion = useReducedMotion();
  const words = text.split(" ");

  if (reduceMotion) return <>{text}</>;

  return (
    <>
      {words.map((word, index) => (
        <motion.span
          className="word-reveal"
          key={`${word}-${index}`}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...SPRING, delay: 0.16 + index * 0.025 }}
        >
          {word}
          {index < words.length - 1 ? "\u00a0" : ""}
        </motion.span>
      ))}
    </>
  );
}

export default function Home() {
  const { t } = usePreferences();
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const pathScale = useTransform(scrollYProgress, [0.03, 0.88], [0, 1]);
  const tokenY = useTransform(scrollYProgress, [0.02, 0.9], ["6vh", "82vh"]);
  const tokenOpacity = useTransform(scrollYProgress, [0, 0.08, 0.92, 1], [0, 1, 1, 0]);
  const timelineScale = useTransform(scrollYProgress, [0.62, 0.84], [0, 1]);

  return (
    <main className="page-shell landing-playground">
      <div className="scroll-journey" aria-hidden="true">
        <motion.span className="journey-line" style={{ scaleY: reduceMotion ? 1 : pathScale }} />
        <motion.span className="journey-token" style={{ y: reduceMotion ? 0 : tokenY, opacity: reduceMotion ? 0.35 : tokenOpacity }} />
      </div>
      <section className="intro hero-section landing-hero">
        <div className="hero-copy">
          <motion.p
            className="eyebrow"
            initial={reduceMotion ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.08 }}
          >
            {t.landing.eyebrow}
          </motion.p>
          <h1>
            <AnimatedWords text={t.landing.title} />
          </h1>
          <motion.p
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.42 }}
          >
            {t.landing.subtitle}
          </motion.p>
          <motion.div
            className="action-row"
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...SPRING, delay: 0.52 }}
          >
            <Link className="button primary" href="/admin/create">
              {t.landing.create}
            </Link>
            <Link className="button secondary" href="/recipient">
              {t.landing.claim}
            </Link>
          </motion.div>
        </div>
      </section>

      <MotionSection className="landing-section journey-section">
        <div className="section-header">
          <p className="eyebrow">{t.landing.howEyebrow}</p>
          <h2>{t.landing.howTitle}</h2>
        </div>

        <div className="steps-grid">
          {t.landing.steps.map(([title, body], index) => {
            const icons = [CheckCircle, Database, ArrowRight, Clock];
            const Icon = icons[index];
            return (
              <motion.div
                className="step-card stream-sweep-card"
                key={title}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={reduceMotion ? { duration: 0 } : { ...SPRING, delay: index * CARD_STAGGER }}
              >
                <div className="step-icon">
                  <Icon size={24} aria-hidden="true" />
                </div>
                <h3>{title}</h3>
                <p>{body}</p>
              </motion.div>
            );
          })}
        </div>
      </MotionSection>

      <MotionSection className="landing-section surface-section journey-section">
        <div className="section-header">
          <p className="eyebrow">{t.landing.useEyebrow}</p>
          <h2>{t.landing.useTitle}</h2>
        </div>

        <div className="use-case-grid">
          {t.landing.useCases.map(([title, body], index) => {
            const icons = [Layers, Coins, CheckCircle, Clock];
            const Icon = icons[index];
            return (
              <motion.div
                className="use-case-card panel stream-sweep-card"
                key={title}
                initial={reduceMotion ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={reduceMotion ? { duration: 0 } : { ...SPRING, delay: index * CARD_STAGGER }}
              >
                <Icon size={28} className="use-case-icon" aria-hidden="true" />
                <h3>{title}</h3>
                <p>{body}</p>
              </motion.div>
            );
          })}
        </div>
      </MotionSection>

      <MotionSection className="landing-section journey-section">
        <div className="section-header">
          <p className="eyebrow">{t.landing.auditEyebrow}</p>
          <h2>{t.landing.auditTitle}</h2>
          <p className="muted">{t.landing.auditSubtitle}</p>
        </div>

        <div className="audit-timeline panel kinetic-timeline">
          <motion.span
            className="timeline-fill"
            aria-hidden="true"
            style={{ scaleY: reduceMotion ? 1 : timelineScale }}
          />
          {t.landing.timeline.map(([title, body], index) => (
            <motion.div
              className="timeline-item"
              key={title}
              initial={reduceMotion ? false : { opacity: 0, x: -14 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={reduceMotion ? { duration: 0 } : { ...SPRING, delay: index * 0.08 }}
            >
              <div className={`timeline-dot ${index === 0 ? "success" : index === 1 ? "active" : "pending"}`} />
              <div className="timeline-content">
                <strong>{title}</strong>
                <span>{body}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </MotionSection>

      <MotionSection className="final-cta">
        <h2>{t.landing.finalTitle}</h2>
        <p className="muted">{t.landing.finalSubtitle}</p>
        <div className="action-row justify-center">
          <Link className="button primary" href="/admin/create">
            {t.landing.create}
          </Link>
          <Link className="button secondary" href="/recipient">
            {t.landing.openRecipient}
          </Link>
        </div>
      </MotionSection>
    </main>
  );
}
