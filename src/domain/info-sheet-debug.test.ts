import { describe, expect, it } from 'vitest'
import {
  buildInfoSheetDebugContext,
  withDebugContext,
} from './info-sheet-debug'
import { zonedWallTime } from './time'
import type { DutyEvent } from './types'
import { evaluate70029 } from './rest-70029'

const HOME = 'America/Toronto'

function duty(id: string, day: number): DutyEvent {
  return {
    id,
    title: 'Duty',
    start: zonedWallTime(HOME, 2026, 7, day, 7, 0),
    end: zonedWallTime(HOME, 2026, 7, day, 14, 0),
    type: 'duty',
    acclTZ: HOME,
    startTZ: HOME,
    endTZ: HOME,
  }
}

describe('buildInfoSheetDebugContext', () => {
  it('includes schedule, ELN/WOCL fields, and 700.29 snapshot', () => {
    const events = [20, 21, 22].map((d) => duty(`d${d}`, d))
    const sheet = {
      badge: 'Duty',
      title: 'Flight duty period',
      rule: 'rule text',
      reference: 'CAR 700.28',
      whyApplies: 'why',
    }
    const report = evaluate70029(events, HOME, 'TC', 'C')
    const text = buildInfoSheetDebugContext({
      sheet,
      focus: { kind: 'event', event: events[2], marker: 'E' },
      events,
      regulator: 'TC',
      acclTZ: HOME,
      homeBaseTZ: HOME,
      timeFreeOption: 'C',
      report70029: report,
    })
    expect(text).toContain('WiseDuty debug context')
    expect(text).toContain('type=duty id=d22')
    expect(text).toContain('ELN=')
    expect(text).toContain('WOCL=')
    expect(text).toContain('700.29 REPORT')
    expect(text).toContain('SCHEDULE (3 events')
    expect(withDebugContext(sheet, {
      focus: { kind: 'generic' },
      events,
      regulator: 'TC',
      acclTZ: HOME,
      homeBaseTZ: HOME,
    }).debugContext).toContain('end debug context')
  })
})
