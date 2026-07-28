import { describe, expect, it } from 'vitest'
import { getAirportByCode, getAirportByIcao, searchAirports } from './airports'

describe('airports', () => {
  it('resolves ICAO and IATA', () => {
    expect(getAirportByIcao('cyul')?.iata).toBe('YUL')
    expect(getAirportByCode('YVR')?.icao).toBe('CYVR')
    expect(getAirportByIcao('CYVR')?.tz).toBe('America/Vancouver')
  })

  it('search ranks exact codes first', () => {
    const r = searchAirports('yyz', 5)
    expect(r[0]?.icao).toBe('CYYZ')
  })

  it('search by city name', () => {
    const r = searchAirports('calgary', 5)
    expect(r.some((a) => a.icao === 'CYYC')).toBe(true)
  })
})
