import { describe, expect, it } from 'vitest'
import {
  avgSectorBandFromMinutes,
  deriveFdpFromFlights,
  selectReportBufferMin,
  selectReleaseBufferMin,
} from './fdp-from-flights'
import { DEFAULT_DUTY_TIMING_BUFFERS, type FlightLeg } from './types'

function leg(
  partial: Partial<FlightLeg> &
    Pick<FlightLeg, 'depIcao' | 'arrIcao' | 'dep' | 'arr'>,
): FlightLeg {
  return {
    id: partial.id || 'x',
    isDeadhead: false,
    ...partial,
  }
}

describe('avgSectorBandFromMinutes', () => {
  it('maps bands', () => {
    expect(avgSectorBandFromMinutes(20)).toBe('<30')
    expect(avgSectorBandFromMinutes(40)).toBe('30-50')
    expect(avgSectorBandFromMinutes(90)).toBe('>=50')
  })
})

describe('buffer selection', () => {
  const b = DEFAULT_DUTY_TIMING_BUFFERS
  it('picks report buffer by first leg kind', () => {
    expect(
      selectReportBufferMin(
        leg({
          depIcao: 'CYUL',
          arrIcao: 'CYYZ',
          dep: new Date(),
          arr: new Date(),
          isDeadhead: false,
        }),
        b,
      ).min,
    ).toBe(b.reportOperatingMin)
    expect(
      selectReportBufferMin(
        leg({
          depIcao: 'CYUL',
          arrIcao: 'CYYZ',
          dep: new Date(),
          arr: new Date(),
          isDeadhead: true,
          customsPreclearance: true,
        }),
        b,
      ).min,
    ).toBe(b.reportDeadheadCustomsMin)
  })

  it('picks release buffer by last leg', () => {
    expect(
      selectReleaseBufferMin(
        leg({
          depIcao: 'CYUL',
          arrIcao: 'CYYZ',
          dep: new Date(),
          arr: new Date(),
          isDeadhead: true,
        }),
        b,
      ).min,
    ).toBe(b.releaseDeadheadMin)
  })
})

describe('deriveFdpFromFlights', () => {
  it('computes report/release and operating sectors with trailing DH', () => {
    // YUL 12:00–13:20 UTC operating; YYZ 18:00–21:00 UTC DH
    const flights: FlightLeg[] = [
      leg({
        id: '1',
        depIcao: 'CYUL',
        arrIcao: 'CYYZ',
        dep: new Date('2026-07-09T12:00:00.000Z'),
        arr: new Date('2026-07-09T13:20:00.000Z'),
        isDeadhead: false,
      }),
      leg({
        id: '2',
        depIcao: 'CYYZ',
        arrIcao: 'CYVR',
        dep: new Date('2026-07-09T18:00:00.000Z'),
        arr: new Date('2026-07-09T21:00:00.000Z'),
        isDeadhead: true,
      }),
    ]
    const r = deriveFdpFromFlights({
      flights,
      regulator: 'TC',
      acclTZ: 'America/Toronto',
    })
    expect(r.ok).toBe(true)
    expect(r.operatingSectors).toBe(1)
    expect(r.positioningSectors).toBe(1)
    expect(r.endsWithPositioning).toBe(true)
    expect(r.operatingEnd?.toISOString()).toBe('2026-07-09T13:20:00.000Z')
    // report = first dep − 60 min
    expect(r.reportAuto.getTime()).toBe(
      flights[0].dep.getTime() - 60 * 60_000,
    )
    // release = last arr + 15 min (DH)
    expect(r.releaseAuto.getTime()).toBe(
      flights[1].arr.getTime() + 15 * 60_000,
    )
    expect(r.startTZ).toBe('America/Toronto')
    expect(r.endTZ).toBe('America/Vancouver')
    expect(r.avgSectorTime).toBe('>=50') // 80 min operating
  })

  it('honours report/release overrides', () => {
    const flights: FlightLeg[] = [
      leg({
        id: '1',
        depIcao: 'CYVR',
        arrIcao: 'CYYC',
        dep: new Date('2026-07-09T16:00:00.000Z'),
        arr: new Date('2026-07-09T17:30:00.000Z'),
      }),
    ]
    const reportOverride = new Date('2026-07-09T14:00:00.000Z')
    const releaseOverride = new Date('2026-07-09T18:00:00.000Z')
    const r = deriveFdpFromFlights({
      flights,
      reportOverride,
      releaseOverride,
    })
    expect(r.ok).toBe(true)
    expect(r.report.getTime()).toBe(reportOverride.getTime())
    expect(r.release.getTime()).toBe(releaseOverride.getTime())
  })
})
