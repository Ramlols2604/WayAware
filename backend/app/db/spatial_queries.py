"""Parameterized SQL for historical incidents along a route.

The route is one GeoJSON LineString parameter. The query does not sample
individual vertices and does not call a routing provider.
"""

ALONG_ROUTE_SQL = """
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
  AND ST_DWithin(
        ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography,
        ST_GeomFromGeoJSON(%(route)s)::geography,
        %(radius_m)s
      )
ORDER BY occurred_at DESC, source, source_id
LIMIT %(limit_plus_one)s
"""
