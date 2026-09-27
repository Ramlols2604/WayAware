import type { HistoricalReportResult, HistoricalReportState } from '../types/api'

export const EMPTY_REPORTS_MESSAGE =
  'No matching reports in the selected window and seven included categories'

export type { HistoricalReportState }

export const idleHistoricalReports: HistoricalReportState = {
  requestId: 0,
  routeId: null,
  status: 'idle',
  reports: [],
  selectedId: null,
  appliedWindow: null,
  coverage: null,
  truncated: false,
  returned: 0,
}

export function beginHistoricalReportRequest(requestId: number, routeId: string): HistoricalReportState {
  return {
    ...idleHistoricalReports,
    requestId,
    routeId,
    status: 'loading',
  }
}

export function reportsForRoute(state: HistoricalReportState, routeId: string | null): HistoricalReportState {
  if (routeId === null) {
    if (state.status === 'idle' && state.reports.length === 0 && state.selectedId === null) return state
    return { ...idleHistoricalReports, requestId: state.requestId }
  }
  if (state.routeId === routeId) return state
  return { ...idleHistoricalReports, requestId: state.requestId, status: 'loading' }
}

export function applyHistoricalReportResponse(
  state: HistoricalReportState,
  requestId: number,
  response: HistoricalReportResult,
): HistoricalReportState {
  if (requestId !== state.requestId) return state
  const reports = response.incidents
  return {
    requestId,
    routeId: state.routeId,
    status: reports.length === 0 ? 'empty' : 'ready',
    reports,
    selectedId: null,
    appliedWindow: response.window,
    coverage: response.coverage,
    truncated: response.truncated,
    returned: response.returned,
  }
}

export function applyHistoricalReportError(state: HistoricalReportState, requestId: number): HistoricalReportState {
  if (requestId !== state.requestId) return state
  return {
    ...idleHistoricalReports,
    requestId,
    routeId: state.routeId,
    status: 'error',
  }
}

export function truncatedReportsMessage(returned: number) {
  return `Showing the latest ${returned} matching reports`
}

export function formatAppliedWindow(window: { start: string; end: string }) {
  return `${formatUtcDate(window.start)} – ${formatUtcDate(window.end)}`
}

export function formatStoredReportDate(iso: string) {
  return formatUtcDate(iso)
}

function formatUtcDate(iso: string) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}
