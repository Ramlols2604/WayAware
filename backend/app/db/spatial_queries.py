"""Parameterized SQL for historical incidents along a route.

The route is one GeoJSON LineString parameter. The query does not sample
individual vertices and does not call a routing provider.

The latitude/longitude predicates are a superset of the corridor. ST_DWithin
remains the exact test. Callers omit those predicates when a containing box
cannot be proved.
"""

_SELECT_LIST = """
SELECT
    source,
    source_id,
    ky_cd,
    ofns_desc,
    pd_desc,
    law_cat_cd,
    occurred_at,
    latitude,
    longitude,
    ST_Distance(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_GeomFromGeoJSON(%(route)s)::geography
    ) AS distance_m
FROM crime_incidents
WHERE occurred_at >= %(start)s
  AND occurred_at < %(end)s
"""

_EXACT_DISTANCE = """
  AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_GeomFromGeoJSON(%(route)s)::geography,
        %(radius_m)s
      )
"""

_ORDER_AND_LIMIT = """
ORDER BY occurred_at DESC, source, source_id
LIMIT %(limit_plus_one)s
"""

ALONG_ROUTE_SQL = _SELECT_LIST + _EXACT_DISTANCE + _ORDER_AND_LIMIT

ALONG_ROUTE_BBOX_SQL = (
    _SELECT_LIST
    + """
  AND latitude >= %(min_lat)s
  AND latitude <= %(max_lat)s
  AND longitude >= %(min_lon)s
  AND longitude <= %(max_lon)s
"""
    + _EXACT_DISTANCE
    + _ORDER_AND_LIMIT
)

ALONG_ROUTE_LATITUDE_SQL = (
    _SELECT_LIST
    + """
  AND latitude >= %(min_lat)s
  AND latitude <= %(max_lat)s
"""
    + _EXACT_DISTANCE
    + _ORDER_AND_LIMIT
)
