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

/** Spotlight when a feature sits in the viewport center band; shrinks again when you scroll past. */
function useFeatureSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setActive(entry.isIntersecting)
      },
      {
        // Middle band of the viewport — only the “shining” feature is active
        rootMargin: '-28% 0px -28% 0px',
        threshold: [0, 0.15, 0.35, 0.55, 0.75, 1],
      },
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { ref, active }
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
  const { ref, active } = useFeatureSpotlight<HTMLElement>()

  return (
    <article
      ref={ref}
      className={`feature-moment ${active ? 'is-active' : ''}`}
      style={{ ['--feature-i' as string]: index }}
    >
      <div className="feature-moment-inner">
        <span className="feature-moment-index" aria-hidden="true">
          {String(index + 1).padStart(2, '0')}
        </span>
        <h2 className="feature-moment-title">{title}</h2>
        <div className="feature-moment-detail" aria-hidden={!active}>
          <div className="feature-moment-line" aria-hidden="true" />
          <p>{detail}</p>
        </div>
      </div>
    </article>
  )
}

function Landing() {
  const [showSettings, setShowSettings] = useState(false)
  /** True once the hero logo has scrolled out — brand becomes the fixed header. */
  const [logoPinned, setLogoPinned] = useState(false)
  const heroLogoRef = useRef<HTMLHeadingElement | null>(null)

  // Ensure the document itself can scroll on this page
  useEffect(() => {
    document.documentElement.classList.add('landing-scroll')
    document.body.classList.add('landing-scroll')
    return () => {
      document.documentElement.classList.remove('landing-scroll')
      document.body.classList.remove('landing-scroll')
    }
  }, [])

  // Pin brand + Get Started once the hero logo crosses above the viewport top
  useEffect(() => {
    const updatePin = () => {
      const logo = heroLogoRef.current
      if (!logo) return
      const top = logo.getBoundingClientRect().top
      // When the large logo reaches / passes the top, it “becomes” the fixed header
      setLogoPinned(top <= 16)
    }

    updatePin()
    // capture: true so nested scroll containers still update the pin state
    window.addEventListener('scroll', updatePin, { passive: true, capture: true })
    window.addEventListener('resize', updatePin)
    return () => {
      window.removeEventListener('scroll', updatePin, true)
      window.removeEventListener('resize', updatePin)
    }
  }, [])

  const scrollToFeatures = () => {
    document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })
  }

  return (
    <>
      <div className={`landing-presentation ${logoPinned ? 'logo-pinned' : ''}`}>
        <div className="landing-ambient" aria-hidden="true" />

        {/*
          Fixed shell always on top.
          Brand + Get Started only appear after the hero logo scrolls away —
          so the first “WiseDuty” becomes the sticky header identity.
        */}
        <header
          className={`landing-fixed-header ${logoPinned ? 'is-pinned' : 'is-top'}`}
        >
          <div className="landing-fixed-inner">
            <div className="landing-fixed-row">
              <div className="landing-fixed-brand-slot">
                <Link
                  to="/"
                  className="landing-fixed-brand"
                  tabIndex={logoPinned ? 0 : -1}
                  aria-hidden={!logoPinned}
                >
                  WiseDuty
                </Link>
              </div>
              <div className="landing-fixed-tools">
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
            <div
              className="landing-fixed-cta-slot"
              aria-hidden={!logoPinned}
            >
              <Link
                to="/signup"
                className="cta-button landing-header-cta"
                tabIndex={logoPinned ? 0 : -1}
              >
                Get Started
              </Link>
            </div>
          </div>
        </header>

        <main>
          <section className="landing-hero" aria-label="Intro">
            <div className="landing-hero-content">
              <p className="landing-eyebrow">Duty awareness, simplified</p>
              <h1 className="landing-hero-logo" ref={heroLogoRef}>
                WiseDuty
              </h1>
              <p className="landing-hero-tagline">
                Invisible <span className="hook-muted">Duty Regs</span> no more.
                Seamlessly add{' '}
                <span className="landing-color-coded">
                  <span className="pill pill-red">color</span>
                  <span className="landing-color-coded-hyphen">-</span>
                  <span className="pill pill-amber">coded</span>{' '}
                  <span className="pill pill-blue">clarity</span>
                </span>{' '}
                for the schedule you actually want to fly.
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
            <div className="landing-features-intro">
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
