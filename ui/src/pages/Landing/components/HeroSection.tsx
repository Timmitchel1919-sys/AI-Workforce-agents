import { Link } from "react-router-dom";
import type { MouseEvent } from "react";
import { ArrowRight, ChevronDown } from "lucide-react";
import { motion, useReducedMotion, type Variants } from "framer-motion";
import { useHeroScrollProgress } from "../hooks/useLandingMotion";
import { useI18n } from "../../../i18n";
import { CONTROL_CENTER_ROUTE, scrollToSection } from "../landingActions";
import { EarthHorizon } from "../../../components/brand/EmblemScenery";
import { RotatingEmblem } from "../../../components/brand/RotatingEmblem";

const container: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.08, delayChildren: 0.1 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] },
  },
};

export function HeroSection() {
  useHeroScrollProgress();
  const { t } = useI18n();
  const reduce = useReducedMotion();

  return (
    <section id="top" className="lp-hero" aria-labelledby="lp-hero-title">
      <EarthHorizon />
      <motion.div
        className="lp-hero__inner"
        initial={reduce ? false : "hidden"}
        animate="visible"
        variants={container}
      >
        <motion.div variants={item}>
          <RotatingEmblem className="lp-hero-emblem" />
        </motion.div>

        <motion.h1 id="lp-hero-title" className="lp-hero__title" variants={item}>
          {t("landing.hero.title")}
        </motion.h1>
        <motion.p className="lp-hero__tagline" variants={item}>
          {t("landing.hero.tagline")}
        </motion.p>
        <motion.p className="lp-hero__product" variants={item}>
          {t("landing.hero.product")}
        </motion.p>
        <motion.p className="lp-hero__description" variants={item}>
          {t("landing.hero.description")}
        </motion.p>
        <motion.p className="lp-hero__verbs" aria-label={t("landing.hero.verbs")} variants={item}>
          <span>{t("landing.hero.architect")}</span>
          <span>{t("landing.hero.build")}</span>
          <span>{t("landing.hero.test")}</span>
          <span>{t("landing.hero.secure")}</span>
          <span>{t("landing.hero.deploy")}</span>
        </motion.p>

        <motion.div className="lp-hero__actions" variants={item}>
          <motion.div
            whileHover={reduce ? undefined : { scale: 1.03, y: -2 }}
            whileTap={reduce ? undefined : { scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            style={{ display: "inline-flex" }}
          >
            <Link to={CONTROL_CENTER_ROUTE} className="lp-button lp-button--primary lp-button--large">
              {t("landing.hero.enter")}
              <ArrowRight size={18} aria-hidden="true" />
            </Link>
          </motion.div>
          <motion.a
            href="#system"
            className="lp-button lp-button--secondary lp-button--large"
            onClick={(e: MouseEvent<HTMLAnchorElement>) => scrollToSection(e, "system")}
            whileHover={reduce ? undefined : { scale: 1.03, y: -2 }}
            whileTap={reduce ? undefined : { scale: 0.97 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
          >
            {t("landing.hero.explore")}
          </motion.a>
        </motion.div>
      </motion.div>

      <motion.a
        href="#system"
        className="lp-hero__scroll"
        aria-label={t("landing.hero.scroll")}
        onClick={(e: MouseEvent<HTMLAnchorElement>) => scrollToSection(e, "system")}
        animate={reduce ? undefined : { y: [0, 6, 0] }}
        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
      >
        <ChevronDown size={20} aria-hidden="true" />
      </motion.a>
    </section>
  );
}

export default HeroSection;
