import { describe, expect, it } from 'vitest'
import type { HistoricalReport, HistoricalReportResult } from '../types/api'
import { HISTORICAL_REPORT_WINDOW } from '../types/api'
import {
  EMPTY_REPORTS_MESSAGE,
  applyHistoricalReportError,
  applyHistoricalReportResponse,
  beginHistoricalReportRequest,
  formatAppliedWindow,
  idleHistoricalReports,
  reportsForRoute,
  truncatedReportsMessage,
} from './historicalReports'

function report(id: string): HistoricalReport {
  return {
    id,
    offense: 'GRAND LARCENY',
    description: 'LARCENY,GRAND FROM VEHICLE, UNATTENDED',
    storedOccurredAt: '2024-05-01T00:00:00Z',
    timeOfDayKnown: false,
    distanceMeters: 12,
    latitude: 40.75,
    longitude: -73.98,
  }
}

function result(incidents: HistoricalReport[], truncated: boolean, returned: number): HistoricalReportResult {
  return {
    window: { start: '2010-01-02T00:00:00Z', end: '2011-03-04T00:00:00Z' },
    returned,
    truncated,
    coverage: {
      detail: 'Coverage includes only the seven selected NYPD complaint categories, not all crime and not live incidents.',
      categories: [{ kyCd: 109, offense: 'GRAND LARCENY' }],
    },
    timestampQuality: 'unverified',
    incidents,
  }
}

describe('historical report state', () => {
  it('clears an open report and its markers when a new request starts', () => {
    const open = {
      ...applyHistoricalReportResponse(beginHistoricalReportRequest(1, 'route-a'), 1, result([report('nypd:1:2020-01-01T00:00:00Z')], false, 1)),
      selectedId: 'nypd:1:2020-01-01T00:00:00Z',
    }

    const next = beginHistoricalReportRequest(2, 'route-b')

    expect(next.reports).toEqual([])
    expect(next.selectedId).toBeNull()
    expect(next.status).toBe('loading')
    expect(reportsForRoute(open, 'route-b').reports).toEqual([])
    expect(reportsForRoute(open, 'route-b').selectedId).toBeNull()
  })

  it('does not let a stale response restore markers from the previous route', () => {
    const loading = beginHistoricalReportRequest(2, 'route-b')
    const current = applyHistoricalReportResponse(
      loading,
      2,
      result([report('nypd:new:2024-05-01T00:00:00Z')], true, 100),
    )
    const stale = applyHistoricalReportResponse(
      current,
      1,
      result([report('nypd:old:2019-01-01T00:00:00Z')], false, 1),
    )

    expect(stale).toBe(current)
    expect(stale.reports.map((item) => item.id)).toEqual(['nypd:new:2024-05-01T00:00:00Z'])

    const cleared = beginHistoricalReportRequest(3, 'route-c')
    const restored = applyHistoricalReportResponse(cleared, 2, result([report('nypd:new:2024-05-01T00:00:00Z')], true, 100))
    expect(restored).toBe(cleared)
    expect(restored.reports).toEqual([])
  })

  it('ignores a stale error so it cannot clear the current reports', () => {
    const current = applyHistoricalReportResponse(
      beginHistoricalReportRequest(2, 'route-b'),
      2,
      result([report('nypd:new:2024-05-01T00:00:00Z')], false, 1),
    )

    expect(applyHistoricalReportError(current, 1)).toBe(current)
  })

  it('uses the applied response window and the returned count', () => {
    expect(HISTORICAL_REPORT_WINDOW).toEqual({
      start: '2006-06-01T00:00:00Z',
      end: '2026-06-01T00:00:00Z',
    })
    expect(formatAppliedWindow({ start: '2010-01-02T00:00:00Z', end: '2011-03-04T00:00:00Z' })).toBe(
      'Jan 2, 2010 – Mar 4, 2011',
    )
    expect(formatAppliedWindow(HISTORICAL_REPORT_WINDOW)).not.toBe(
      formatAppliedWindow({ start: '2010-01-02T00:00:00Z', end: '2011-03-04T00:00:00Z' }),
    )
    expect(truncatedReportsMessage(100)).toBe('Showing the latest 100 matching reports')
    expect(truncatedReportsMessage(37)).toBe('Showing the latest 37 matching reports')
    expect(EMPTY_REPORTS_MESSAGE).toBe(
      'No matching reports in the selected window and seven included categories',
    )
    expect(idleHistoricalReports.reports).toEqual([])
  })
})
