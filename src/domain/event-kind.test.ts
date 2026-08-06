import { describe, expect, it } from 'vitest'
import {
  defaultWorkFactorForKind,
  EVENT_KIND_ORDER,
  eventKindToDutyType,
  fieldsForEventKind,
  inferEventKind,
  isNonFlightDutyKind,
  isReserveOrStandbyKind,
  titleForEventKind,
  type EventKind,
} from './types'

describe('eventKindToDutyType', () => {
  it('maps flight and training kinds to duty', () => {
    expect(eventKindToDutyType('flight_duty')).toBe('duty')
    expect(eventKindToDutyType('simulator')).toBe('duty')
    expect(eventKindToDutyType('ground_school')).toBe('duty')
    expect(eventKindToDutyType('e_class')).toBe('duty')
  })

  it('maps reserve and standby kinds', () => {
    expect(eventKindToDutyType('airport_reserve')).toBe('reserve')
    expect(eventKindToDutyType('home_reserve')).toBe('reserve')
    expect(eventKindToDutyType('airport_standby')).toBe('standby')
    expect(eventKindToDutyType('home_standby')).toBe('standby')
  })

  it('maps free (suggest-only, not in Add Event dropdown)', () => {
    expect(eventKindToDutyType('free')).toBe('free')
  })
})

describe('EVENT_KIND_ORDER', () => {
  it('does not include free time as a user-created type', () => {
    expect(EVENT_KIND_ORDER).not.toContain('free')
  })
})

describe('defaultWorkFactorForKind', () => {
  it('uses CAR 700.29 factors', () => {
    expect(defaultWorkFactorForKind('flight_duty')).toBe(1)
    expect(defaultWorkFactorForKind('airport_standby')).toBe(1)
    expect(defaultWorkFactorForKind('home_reserve')).toBe(0.33)
    expect(defaultWorkFactorForKind('free')).toBe(0)
  })
})

describe('fieldsForEventKind', () => {
  it('gives flights only for flight duty', () => {
    expect(fieldsForEventKind('flight_duty').has('flights')).toBe(true)
    expect(fieldsForEventKind('airport_reserve').has('flights')).toBe(false)
    expect(fieldsForEventKind('simulator').has('flights')).toBe(false)
  })

  it('offers Add Flight handoff on reserve/standby kinds (add or edit)', () => {
    // Form enables + Add Flight whenever this field is present (not mode-gated).
    const kinds: EventKind[] = [
      'airport_reserve',
      'airport_standby',
      'home_reserve',
      'home_standby',
    ]
    for (const k of kinds) {
      expect(fieldsForEventKind(k).has('addFlightHandoff')).toBe(true)
    }
    expect(fieldsForEventKind('flight_duty').has('addFlightHandoff')).toBe(
      false,
    )
  })

  it('requires location for airport reserve/standby and training', () => {
    expect(fieldsForEventKind('airport_reserve').has('location')).toBe(true)
    expect(fieldsForEventKind('home_reserve').has('location')).toBe(false)
    expect(fieldsForEventKind('simulator').has('location')).toBe(true)
  })
})

describe('inferEventKind', () => {
  it('prefers stored eventKind', () => {
    expect(
      inferEventKind({ type: 'reserve', eventKind: 'airport_reserve' }),
    ).toBe('airport_reserve')
  })

  it('infers legacy events', () => {
    expect(inferEventKind({ type: 'duty' })).toBe('flight_duty')
    expect(inferEventKind({ type: 'reserve' })).toBe('home_reserve')
    expect(inferEventKind({ type: 'standby' })).toBe('home_standby')
    expect(inferEventKind({ type: 'free' })).toBe('free')
  })
})

describe('kind helpers', () => {
  it('classifies reserve/standby and non-flight duty', () => {
    expect(isReserveOrStandbyKind('airport_reserve')).toBe(true)
    expect(isReserveOrStandbyKind('flight_duty')).toBe(false)
    expect(isNonFlightDutyKind('simulator')).toBe(true)
    expect(isNonFlightDutyKind('flight_duty')).toBe(false)
  })

  it('has human titles', () => {
    expect(titleForEventKind('e_class')).toBe('E-Class')
    expect(titleForEventKind('ground_school')).toBe('Ground School')
  })
})
