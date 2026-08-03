import { describe, expect, it } from 'vitest'
import {
  buildImportDrafts,
  extractFlightsFromEvent,
  groupEventsIntoFdpClusters,
  importScheduleFromEvents,
  parseEmbeddedClock,
  parseRouteAirports,
  resolveReportForCluster,
  tryParseFlightEvent,
  type ImportCalendarEvent,
} from './schedule-import'
import { DEFAULT_DUTY_TIMING_BUFFERS } from './types'

const HOME = 'America/Toronto'

function ev(
  partial: Partial<ImportCalendarEvent> &
    Pick<ImportCalendarEvent, 'id' | 'start' | 'end'>,
): ImportCalendarEvent {
  return {
    title: '',
    allDay: false,
    ...partial,
  }
}

describe('parseRouteAirports', () => {
  it('parses common route formats', () => {
    expect(parseRouteAirports('YYZ-YVR')?.depIcao).toBe('CYYZ')
    expect(parseRouteAirports('Flight YUL→YYZ')?.arrIcao).toBe('CYYZ')
    expect(parseRouteAirports('CYYZ / CYVR')?.depIcao).toBe('CYYZ')
  })
})

describe('parseEmbeddedClock', () => {
  it('reads report times', () => {
    expect(parseEmbeddedClock('Report 05:45', 'report')).toEqual({
      hour: 5,
      minute: 45,
    })
    expect(parseEmbeddedClock('RPT 0545', 'report')).toEqual({
      hour: 5,
      minute: 45,
    })
    expect(parseEmbeddedClock('Show: 5:45 PM', 'report')).toEqual({
      hour: 17,
      minute: 45,
    })
  })
})

describe('tryParseFlightEvent', () => {
  it('extracts flight from title times', () => {
    const f = tryParseFlightEvent(
      ev({
        id: '1',
        title: 'YYZ-YVR AC123',
        start: new Date('2026-07-10T13:00:00Z'),
        end: new Date('2026-07-10T18:00:00Z'),
      }),
    )
    expect(f?.depIcao).toBe('CYYZ')
    expect(f?.arrIcao).toBe('CYVR')
    expect(f?.isDeadhead).toBe(false)
  })

  it('flags deadhead', () => {
    const f = tryParseFlightEvent(
      ev({
        id: '2',
        title: 'DH YVR-YYZ',
        start: new Date('2026-07-10T20:00:00Z'),
        end: new Date('2026-07-11T01:00:00Z'),
      }),
    )
    expect(f?.isDeadhead).toBe(true)
  })
})

describe('groupEventsIntoFdpClusters', () => {
  it('splits on long rest gap', () => {
    const a = ev({
      id: 'a',
      title: 'YYZ-YUL',
      start: new Date('2026-07-10T12:00:00Z'),
      end: new Date('2026-07-10T14:00:00Z'),
    })
    const b = ev({
      id: 'b',
      title: 'YUL-YYZ',
      start: new Date('2026-07-10T16:00:00Z'),
      end: new Date('2026-07-10T18:00:00Z'),
    })
    const c = ev({
      id: 'c',
      title: 'YYZ-YVR',
      start: new Date('2026-07-11T14:00:00Z'),
      end: new Date('2026-07-11T20:00:00Z'),
    })
    const clusters = groupEventsIntoFdpClusters([a, b, c], 9)
    expect(clusters).toHaveLength(2)
    expect(clusters[0]).toHaveLength(2)
    expect(clusters[1]).toHaveLength(1)
  })
})

describe('resolveReportForCluster / Auto', () => {
  const flight = ev({
    id: 'f1',
    title: 'YYZ-YUL',
    start: new Date('2026-07-10T14:00:00Z'), // ~10:00 Toronto EDT
    end: new Date('2026-07-10T15:30:00Z'),
  })

  it('uses Report event start when present', () => {
    const report = ev({
      id: 'r1',
      title: 'Report',
      start: new Date('2026-07-10T12:45:00Z'),
      end: new Date('2026-07-10T13:00:00Z'),
    })
    const flights = [tryParseFlightEvent(flight)!]
    const res = resolveReportForCluster(
      [report, flight],
      flights,
      'auto',
      DEFAULT_DUTY_TIMING_BUFFERS,
      HOME,
    )
    expect(res.source).toBe('calendar_report_event')
    expect(res.overridden).toBe(true)
    expect(res.report.getTime()).toBe(report.start.getTime())
  })

  it('uses embedded Report HH:mm from notes', () => {
    const withNotes = {
      ...flight,
      notes: 'Report 05:45 local',
    }
    const flights = [tryParseFlightEvent(withNotes)!]
    const res = resolveReportForCluster(
      [withNotes],
      flights,
      'auto',
      DEFAULT_DUTY_TIMING_BUFFERS,
      HOME,
    )
    expect(res.source).toBe('calendar_embedded_time')
    expect(res.overridden).toBe(true)
  })

  it('falls back to buffers when no report info', () => {
    const flights = [tryParseFlightEvent(flight)!]
    const res = resolveReportForCluster(
      [flight],
      flights,
      'auto',
      DEFAULT_DUTY_TIMING_BUFFERS,
      HOME,
    )
    expect(res.source).toBe('buffers')
    expect(res.overridden).toBe(false)
    // 60 min report buffer default
    expect(res.report.getTime()).toBe(flight.start.getTime() - 60 * 60_000)
  })
})

describe('importScheduleFromEvents', () => {
  it('builds duty with flights and summary', () => {
    const result = importScheduleFromEvents(
      [
        ev({
          id: '1',
          title: 'Report 06:00',
          notes: 'Show',
          start: new Date('2026-07-10T10:00:00Z'),
          end: new Date('2026-07-10T10:15:00Z'),
        }),
        ev({
          id: '2',
          title: 'YYZ-YUL',
          start: new Date('2026-07-10T12:00:00Z'),
          end: new Date('2026-07-10T13:20:00Z'),
        }),
      ],
      { homeBaseTZ: HOME, reportMode: 'auto' },
    )
    expect(result.duties).toHaveLength(1)
    expect(result.duties[0].flights?.length).toBe(1)
    expect(result.drafts[0].reportSource).toBe('calendar_report_event')
  })
})

describe('Flight Crew View report events', () => {
  const fcvNotes = `Report: 1435L
End: 1645L
SA01 DH 816 YYZ-YUL 1520-1645


Created by the Flight Crew View App. Contact us at support@flightcrewview.com`

  /** Report 14:35 Toronto = 18:35 UTC in July (EDT) */
  const reportStart = new Date('2026-07-10T18:35:00.000Z')
  const eventEnd = new Date('2026-07-10T20:45:00.000Z') // 16:45 EDT

  it('parses Report: 1435L and End: 1645L clocks', () => {
    expect(parseEmbeddedClock('Report: 1435L', 'report')).toEqual({
      hour: 14,
      minute: 35,
    })
    expect(parseEmbeddedClock('End: 1645L', 'release')).toEqual({
      hour: 16,
      minute: 45,
    })
  })

  it('extracts DH flight YYZ-YUL 1520-1645 from FCV body', () => {
    const e = ev({
      id: 'fcv1',
      title: 'Report: 1435L',
      notes: fcvNotes,
      start: reportStart,
      end: eventEnd,
    })
    const legs = extractFlightsFromEvent(e, HOME)
    expect(legs).toHaveLength(1)
    expect(legs[0].depIcao).toBe('CYYZ')
    expect(legs[0].arrIcao).toBe('CYUL')
    expect(legs[0].isDeadhead).toBe(true)
    // 15:20 Toronto EDT = 19:20 UTC
    expect(legs[0].dep.toISOString()).toBe('2026-07-10T19:20:00.000Z')
    // 16:45 Toronto EDT = 20:45 UTC
    expect(legs[0].arr.toISOString()).toBe('2026-07-10T20:45:00.000Z')
  })

  it('imports FCV event with report at event start and body flights', () => {
    const result = importScheduleFromEvents(
      [
        ev({
          id: 'fcv1',
          title: 'Report: 1435L',
          notes: fcvNotes,
          start: reportStart,
          end: eventEnd,
        }),
      ],
      { homeBaseTZ: HOME, reportMode: 'auto' },
    )
    expect(result.duties).toHaveLength(1)
    const d = result.duties[0]
    expect(d.flights).toHaveLength(1)
    expect(d.flights![0].isDeadhead).toBe(true)
    expect(d.reportOverridden).toBe(true)
    expect(d.start.getTime()).toBe(reportStart.getTime())
    expect(result.drafts[0].reportSource).toBe('calendar_report_event')
    expect(result.drafts[0].reportReason).toMatch(/Flight Crew View|Report/i)
    // End: 1645L → release override
    expect(d.releaseOverridden).toBe(true)
  })

  it('parses multiple FCV legs in one notes block', () => {
    const notes = `Report: 0600L
End: 1400L
SA01 100 YYZ-YUL 0700-0820
SA01 200 YUL-YYZ 1000-1120
Created by the Flight Crew View App.`
    const e = ev({
      id: 'm',
      title: 'Report: 0600L',
      notes,
      start: new Date('2026-07-10T10:00:00.000Z'),
      end: new Date('2026-07-10T18:00:00.000Z'),
    })
    const legs = extractFlightsFromEvent(e, HOME)
    expect(legs).toHaveLength(2)
    expect(legs[0].isDeadhead).toBe(false)
    expect(legs[1].depIcao).toBe('CYUL')
  })
})

describe('buildImportDrafts', () => {
  it('skips all-day events', () => {
    const { skippedEvents } = buildImportDrafts(
      [
        ev({
          id: 'a',
          title: 'Vacation',
          allDay: true,
          start: new Date('2026-07-10T00:00:00Z'),
          end: new Date('2026-07-11T00:00:00Z'),
        }),
      ],
      { homeBaseTZ: HOME },
    )
    expect(skippedEvents.some((s) => s.reason.includes('All-day'))).toBe(true)
  })
})
