import { describe, expect, it } from 'vitest'
import { boundsForPoints } from './routeLayer'

describe('route frame', () => {
  it('includes selected endpoints that sit off the returned line', () => {
    const line: [number, number][] = [
      [-73.985, 40.758],
      [-73.98, 40.752],
    ]
    const bounds = boundsForPoints([...line, [-73.9862, 40.7591], [-73.977, 40.751]])
    expect(bounds).toEqual({ west: -73.9862, south: 40.751, east: -73.977, north: 40.7591 })
  })

  it('reads longitude first', () => {
    const bounds = boundsForPoints([
      [-73.99, 40.75],
      [-73.97, 40.76],
    ])
    expect(bounds?.west).toBe(-73.99)
    expect(bounds?.south).toBe(40.75)
  })
})
