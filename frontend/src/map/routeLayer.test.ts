import { describe, expect, it } from 'vitest'
import { alternativeCollection, boundsForPoints } from './routeLayer'

describe('route frame', () => {
  it('includes selected endpoints that sit off the returned line', () => {
    const line: [number, number][] = [
      [-73.985, 40.758],
      [-73.98, 40.752],
    ]
    const bounds = boundsForPoints([...line, [-73.9862, 40.7591], [-73.977, 40.751]])
    expect(bounds).toEqual({ west: -73.9862, south: 40.751, east: -73.977, north: 40.7591 })
  })

  it('keeps each unselected route id and its full geometry', () => {
    const selected: [number, number][] = [
      [-73.985, 40.758],
      [-73.98, 40.752],
    ]
    const other: [number, number][] = [
      [-73.99, 40.76],
      [-73.975, 40.755],
      [-73.97, 40.75],
    ]
    const drawn = [
      { routeId: 'route-1', coordinates: selected },
      { routeId: 'route-2', coordinates: other },
    ].filter((route) => route.routeId !== 'route-1')
    expect(alternativeCollection(drawn).features).toEqual([
      {
        type: 'Feature',
        properties: { routeId: 'route-2' },
        geometry: { type: 'LineString', coordinates: other },
      },
    ])
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
