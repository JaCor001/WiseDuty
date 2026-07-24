import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import './App.css'
import './Landing.css'
import SettingsPanel from './shared/ui/SettingsPanel'
import ThemeToggle from './shared/ui/ThemeToggle'
import { IconSettings } from './shared/ui/icons'

const FEATURES = [
  {
    id: 'color-coded',
    title: 'Crystal-clear duty awareness in one color-coded glance.',
    detail:
      'Placeholder: See duty, rest, and risk levels at a glance with calm color cues—so your schedule communicates before you dig into the details.',
  },
  {
    id: 'shield',
    title: 'Your shield against reduced duty situational awareness.',
    detail:
      'Placeholder: Stay ahead of fatigue and regulatory edges with gentle signals that surface what matters, without burying you in rule text.',
  },
  {
    id: 'optimize',
    title: 'Bid smarter, trade pairings, and optimize at a glance.',
    detail:
      'Placeholder: Compare options faster when bidding or trading—spot conflicts early and choose the pairing that fits both regs and life.',
  },
  {
    id: 'custom',
    title: 'Suggestions that align regulations with your preferences.',
    detail:
      'Placeholder: Tailored schedule ideas that respect your regulator settings, time zones, and the way you actually like to fly.',
  },
  {
    id: 'mental-load',
    title: 'Let WiseDuty carry the mental load of every duty reg.',
    detail:
      'Placeholder: Offload the bookkeeping so you can focus on the schedule you want—not on memorizing tables and edge cases.',
  },
] as const

function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          // Keep visible once revealed for a polished one-shot moment
          observer.unobserve(el)
        }
      },
      { threshold: 0.35, rootMargin: '0px 0px -8% 0px' },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, visible }
}

function FeatureMoment({
  index,
  title,
  detail,
}: {
  index: number
  title: string
  detail: string
}) {
  const { ref, visible } = useRevealOnScroll<HTMLElement>()

  return (
    <article
      ref={ref}
      className={`feature-moment ${visible ? 'is-visible' : ''}`}
      style={{ ['--feature-i' as string]: index }}
    >
      <div className="feature-moment-inner">
        <span className="feature-moment-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 className="feature-moment-title">{title}</h2>
        <div className="feature-moment-detail" aria-hidden={!visible}>
          <div className="feature-moment-line" aria-hidden="true" />
          <p>{detail}</p>
        </div>
      </div>
    </article>
  )
}

function Landing() {
  const [showSettings, setShowSettings] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const heroRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <div className="landing-presentation">
        <div className="landing-ambient" aria-hidden="true" />

        <header
          className={`landing-sticky-header ${scrolled ? 'is-scrolled' : ''}`}
        >
          <div className="landing-sticky-inner">
            <div className="landing-sticky-top">
              <Link to="/" className="landing-brand">
                WiseDuty
              </Link>
              <div className="landing-sticky-tools">
                <Link to="/calendar" className="landing-nav-link">
                  Calendar
                </Link>
                <Link to="/login" className="landing-nav-link">
                  Login
                </Link>
                <button
                  type="button"
                  className="settings-button"
                  aria-label="Settings"
                  onClick={() => setShowSettings(true)}
                >
                  <IconSettings />
                </button>
                <ThemeToggle />
              </div>
            </div>
            <div className="landing-sticky-cta">
              <Link to="/signup" className="cta-button landing-header-cta">
                Get Started
              </Link>
            </div>
          </div>
        </header>

        <main>
          <section className="landing-hero" ref={heroRef} aria-label="Intro">
            <div className="landing-hero-content">
              <p className="landing-eyebrow">Duty awareness, simplified</p>
              <h1 className="landing-hero-logo">WiseDuty</h1>
              <p className="landing-hero-tagline">
                Invisible duty regs no more. Color-coded clarity for the schedule
                you actually want to fly.
              </p>
              <div className="landing-hero-actions">
                <Link to="/signup" className="cta-button">
                  Get Started
                </Link>
                <button
                  type="button"
                  className="landing-scroll-cue"
                  onClick={scrollToFeatures}
                >
                  Explore features
                  <span className="landing-scroll-chevron" aria-hidden="true">
                    ↓
                  </span>
                </button>
              </div>
            </div>
          </section>

          <section
            id="features"
            className="landing-features"
            aria-label="Features"
          >
            <div className="landing-features-intro reveal-block">
              <h2>Built for the flight deck of life</h2>
              <p>
                Scroll through each capability—every line gets its moment.
              </p>
            </div>

            {FEATURES.map((feature, index) => (
              <FeatureMoment
                key={feature.id}
                index={index}
                title={feature.title}
                detail={feature.detail}
              />
            ))}
          </section>

          <section className="landing-video-section" aria-label="Demo video">
            <div className="landing-video-inner">
              <h2>See it in motion</h2>
              <p className="landing-video-caption">
                Placeholder for product walkthrough video
              </p>
              <div className="landing-video-frame">
                <div className="landing-video-placeholder">
                  <span className="landing-video-play" aria-hidden="true">
                    ▶
                  </span>
                  <span>Demo video coming soon</span>
                </div>
              </div>
              <Link to="/signup" className="cta-button landing-video-cta">
                Get Started
              </Link>
            </div>
          </section>
        </main>

        <footer className="landing-footer">
          <p>
            &copy; {new Date().getFullYear()} WiseDuty. All rights reserved.
          </p>
        </footer>
      </div>

      {showSettings && (
        <SettingsPanel onClose={() => setShowSettings(false)} />
      )}
    </>
  )
}

export default Landing
