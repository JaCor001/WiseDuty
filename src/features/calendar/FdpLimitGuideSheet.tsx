/**
 * Interactive CAR 700.63 UOC / FDP extension guideline sheet.
 */
import { useMemo, useState } from 'react'
import type { DutyEvent } from '../../domain/types'
import type { FdpNearMaxResult } from '../../domain/fdp-near-limit'
import {
  assessUocExtension,
  maxUocExtensionHours,
  type UocAnswers,
  type UocCrewConfig,
  UOC_EMPTY_ANSWERS,
  UOC_GUIDELINE_STEPS,
} from '../../domain/uoc-extension'
import './FdpLimitGuideSheet.css'

export interface FdpLimitGuideSheetProps {
  mode: 'extension' | 'uoc'
  duty: DutyEvent
  assessment: FdpNearMaxResult
  onClose: () => void
}

export default function FdpLimitGuideSheet({
  mode,
  duty,
  assessment,
  onClose,
}: FdpLimitGuideSheetProps) {
  const [answers, setAnswers] = useState<UocAnswers>({ ...UOC_EMPTY_ANSWERS })
  const [step, setStep] = useState(0)

  const result = useMemo(
    () =>
      assessUocExtension({
        actualHours: assessment.actualHours,
        maxFdpHours: assessment.maxFdpHours,
        rdpLimiting: assessment.rdpLimiting,
        operatingSectors: duty.operatingSectors,
        answers,
      }),
    [assessment, duty.operatingSectors, answers],
  )

  const title =
    mode === 'uoc'
      ? 'Review UOC guidelines (CAR 700.63)'
      : 'Review extending duty guidelines (CAR 700.63)'

  const known = [
    `Duty: ${assessment.message || `${assessment.actualHours.toFixed(1)} h / max ${assessment.maxFdpHours.toFixed(1)} h`}`,
    assessment.rdpLimiting
      ? 'Limit source: reserve duty period (700.70) is tighter than 700.28 FDP.'
      : 'Limit source: Max FDP (700.28' +
        (duty.splitBreak ? ' + split 700.50' : '') +
        ').',
    duty.operatingSectors != null
      ? `Operating sectors on this FDP: ${duty.operatingSectors}.`
      : null,
  ].filter(Boolean) as string[]

  const setYesNo = (
    key: 'uocTimingOk' | 'crewConsulted' | 'picAgrees',
    value: boolean,
  ) => {
    setAnswers((a) => ({ ...a, [key]: value }))
    setStep((s) => Math.min(s + 1, UOC_GUIDELINE_STEPS.length))
  }

  const setCrew = (crewConfig: UocCrewConfig) => {
    setAnswers((a) => ({ ...a, crewConfig }))
    setStep(UOC_GUIDELINE_STEPS.length + 1)
  }

  const showCrew =
    step >= UOC_GUIDELINE_STEPS.length &&
    answers.uocTimingOk === true &&
    answers.crewConsulted === true &&
    answers.picAgrees === true
  const showResult =
    answers.uocTimingOk === false ||
    answers.crewConsulted === false ||
    answers.picAgrees === false ||
    (answers.uocTimingOk != null &&
      answers.crewConsulted != null &&
      answers.picAgrees != null &&
      answers.crewConfig != null)

  return (
    <div
      className="fdp-guide-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="fdp-guide-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fdp-guide-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="fdp-guide-header">
          <h2 id="fdp-guide-title">{title}</h2>
          <button
            type="button"
            className="fdp-guide-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="fdp-guide-body">
          <section className="fdp-guide-section">
            <h3>Known from schedule</h3>
            <ul>
              {known.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </section>

          <section className="fdp-guide-section">
            <h3>Decision scheme</h3>
            <p className="fdp-guide-hint">
              Answer each question. Final assessment uses your answers plus
              schedule data.
            </p>

            {UOC_GUIDELINE_STEPS.map((s, i) => {
              if (i > step) return null
              const key =
                s.id === 'timing'
                  ? 'uocTimingOk'
                  : s.id === 'consult'
                    ? 'crewConsulted'
                    : 'picAgrees'
              const val = answers[key]
              return (
                <div key={s.id} className="fdp-guide-step">
                  <p className="fdp-guide-q">
                    <span className="fdp-guide-step-num">{i + 1}</span>
                    {s.question}
                  </p>
                  {val == null ? (
                    <div className="fdp-guide-yesno">
                      <button
                        type="button"
                        className="fdp-guide-btn fdp-guide-btn-yes"
                        onClick={() => setYesNo(key, true)}
                      >
                        {s.yesLabel}
                      </button>
                      <button
                        type="button"
                        className="fdp-guide-btn fdp-guide-btn-no"
                        onClick={() => setYesNo(key, false)}
                      >
                        {s.noLabel}
                      </button>
                    </div>
                  ) : (
                    <p className="fdp-guide-answered">
                      {val ? `✓ ${s.yesLabel}` : `✗ ${s.noLabel}`}
                      <button
                        type="button"
                        className="fdp-guide-link"
                        onClick={() => {
                          setAnswers((a) => ({
                            ...a,
                            [key]: null,
                            crewConfig:
                              key === 'picAgrees' || key === 'crewConsulted'
                                ? null
                                : a.crewConfig,
                          }))
                          setStep(i)
                        }}
                      >
                        Change
                      </button>
                    </p>
                  )}
                </div>
              )
            })}

            {showCrew &&
              answers.uocTimingOk !== false &&
              answers.crewConsulted !== false &&
              answers.picAgrees !== false && (
                <div className="fdp-guide-step">
                  <p className="fdp-guide-q">
                    <span className="fdp-guide-step-num">4</span>
                    Crew configuration (sets max UOC extension)
                  </p>
                  {answers.crewConfig == null ? (
                    <div className="fdp-guide-crew">
                      {(
                        [
                          ['single_pilot', 'Single pilot (+1 h)'],
                          ['two_pilot', 'Two pilots, not augmented (+2 h)'],
                          [
                            'augmented_1_flight',
                            'Augmented · 1 flight in FDP (+3 h)',
                          ],
                          [
                            'augmented_2_3_flights',
                            'Augmented · 2–3 flights (+2 h)',
                          ],
                        ] as const
                      ).map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          className="fdp-guide-btn fdp-guide-btn-choice"
                          onClick={() => setCrew(id)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="fdp-guide-answered">
                      ✓{' '}
                      {answers.crewConfig === 'single_pilot'
                        ? 'Single pilot'
                        : answers.crewConfig === 'two_pilot'
                          ? 'Two pilots'
                          : answers.crewConfig === 'augmented_1_flight'
                            ? 'Augmented · 1 flight'
                            : 'Augmented · 2–3 flights'}{' '}
                      (+{maxUocExtensionHours(answers.crewConfig)} h)
                      <button
                        type="button"
                        className="fdp-guide-link"
                        onClick={() => {
                          setAnswers((a) => ({ ...a, crewConfig: null }))
                          setStep(UOC_GUIDELINE_STEPS.length)
                        }}
                      >
                        Change
                      </button>
                    </p>
                  )}
                </div>
              )}
          </section>

          {showResult && (
            <section
              className={`fdp-guide-result${
                result.allowed === true
                  ? ' is-ok'
                  : result.allowed === false
                    ? ' is-no'
                    : ''
              }`}
            >
              <h3>Assessment</h3>
              <p className="fdp-guide-summary">{result.summary}</p>
              <ul>
                {result.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="fdp-guide-ref">
                Reference: CAR 700.63; AC 700-047 §§4.70–4.74
                {assessment.rdpLimiting ? '; CAR 700.70 (RDP)' : ''}.
              </p>
            </section>
          )}
        </div>

        <footer className="fdp-guide-footer">
          <button
            type="button"
            className="fdp-guide-btn fdp-guide-btn-primary"
            onClick={onClose}
          >
            Got it
          </button>
        </footer>
      </div>
    </div>
  )
}
