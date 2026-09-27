import math
from datetime import datetime, timezone

from app.db.route_bounds import candidate_bounds, yearly_slices

UTC = timezone.utc


def test_yearly_slices_partition_a_twenty_year_window_without_gaps():
    start = datetime(2006, 6, 1, tzinfo=UTC)
    end = datetime(2026, 6, 1, tzinfo=UTC)

    slices = yearly_slices(start, end)

    assert len(slices) == 20
    _assert_half_open_partition(slices, start, end)
    assert slices[0] == (datetime(2025, 6, 1, tzinfo=UTC), end)
    assert slices[-1] == (start, datetime(2007, 6, 1, tzinfo=UTC))


def test_leap_day_slices_stay_half_open_and_cover_february_29():
    start = datetime(2020, 2, 28, 12, tzinfo=UTC)
    end = datetime(2024, 2, 29, 12, tzinfo=UTC)

    slices = yearly_slices(start, end)

    _assert_half_open_partition(slices, start, end)
    leap_day = datetime(2024, 2, 29, tzinfo=UTC)
    assert _containing_slices(slices, leap_day) == [slices[0]]
    previous_leap = datetime(2020, 2, 29, tzinfo=UTC)
    assert _containing_slices(slices, previous_leap) == [slices[-1]]


def test_window_shorter_than_a_year_is_one_slice():
    start = datetime(2024, 2, 29, tzinfo=UTC)
    end = datetime(2025, 2, 28, tzinfo=UTC)

    assert yearly_slices(start, end) == [(start, end)]


def test_bounding_box_contains_a_curved_high_latitude_segment():
    coordinates = [[0.0, 60.0], [20.0, 60.0]]
    bounds = candidate_bounds(coordinates, radius_m=50)

    assert bounds is not None
    assert bounds.min_lon is not None and bounds.max_lon is not None
    for fraction in (0.0, 0.25, 0.5, 0.75, 1.0):
        lat, lon = _spherical_point(60.0, 0.0, 60.0, 20.0, fraction)
        assert bounds.min_lat <= lat <= bounds.max_lat
        assert bounds.min_lon <= lon <= bounds.max_lon
    midpoint_lat, _midpoint_lon = _spherical_point(60.0, 0.0, 60.0, 20.0, 0.5)
    assert midpoint_lat > 60.0


def test_bounding_box_contains_points_within_the_radius_of_an_endpoint():
    bounds = candidate_bounds([[-73.98, 40.75], [-73.97, 40.76]], radius_m=50)

    assert bounds is not None
    north = 40.75 + (40.0 / 110_574.0)
    assert bounds.min_lat <= north <= bounds.max_lat
    assert bounds.min_lon is not None
    assert bounds.min_lon <= -73.98 <= bounds.max_lon


def test_antimeridian_segment_does_not_use_a_longitude_range_that_drops_the_short_arc():
    bounds = candidate_bounds([[179.0, 10.0], [-179.0, 10.2]], radius_m=50)

    assert bounds is not None
    assert bounds.min_lon is None
    assert bounds.max_lon is None
    assert bounds.min_lat <= 10.0 <= bounds.max_lat
    assert bounds.max_lat >= 10.2


def test_ambiguous_half_world_segment_has_no_candidate_box():
    assert candidate_bounds([[0.0, 0.0], [180.0, 0.0]], radius_m=50) is None


def test_segment_that_reaches_a_pole_does_not_bound_longitude():
    north = candidate_bounds([[0.0, 89.999], [0.01, 89.999]], radius_m=200)
    south = candidate_bounds([[0.0, -89.999], [0.01, -89.999]], radius_m=200)

    assert north is not None and south is not None
    assert north.min_lon is None and north.max_lon is None
    assert south.min_lon is None and south.max_lon is None
    assert north.max_lat == 90.0
    assert south.min_lat == -90.0


def test_southern_hemisphere_curve_stays_inside_the_box():
    coordinates = [[10.0, -50.0], [30.0, -50.0]]
    bounds = candidate_bounds(coordinates, radius_m=100)

    assert bounds is not None
    assert bounds.min_lon is not None and bounds.max_lon is not None
    for step in range(21):
        lat, lon = _spherical_point(-50.0, 10.0, -50.0, 30.0, step / 20.0)
        assert bounds.min_lat <= lat <= bounds.max_lat
        assert bounds.min_lon <= lon <= bounds.max_lon
    assert _spherical_point(-50.0, 10.0, -50.0, 30.0, 0.5)[0] < -50.0


def _assert_half_open_partition(slices, start, end):
    assert slices[0][1] == end
    assert slices[-1][0] == start
    for newer, older in zip(slices, slices[1:], strict=False):
        assert newer[0] == older[1]
        assert newer[0] < newer[1]
        boundary = newer[0]
        assert _containing_slices(slices, boundary) == [newer]


def _containing_slices(slices, moment):
    return [item for item in slices if item[0] <= moment < item[1]]


def _spherical_point(lat1, lon1, lat2, lon2, fraction):
    phi1 = math.radians(lat1)
    lambda1 = math.radians(lon1)
    phi2 = math.radians(lat2)
    delta_lon = (lon2 - lon1 + 180.0) % 360.0 - 180.0
    lambda2 = lambda1 + math.radians(delta_lon)
    angular = 2.0 * math.asin(
        min(
            1.0,
            math.sqrt(
                math.sin((phi2 - phi1) / 2.0) ** 2
                + math.cos(phi1)
                * math.cos(phi2)
                * math.sin(math.radians(delta_lon) / 2.0) ** 2
            ),
        )
    )
    if angular == 0.0:
        return lat1, lon1
    a = math.sin((1.0 - fraction) * angular) / math.sin(angular)
    b = math.sin(fraction * angular) / math.sin(angular)
    x = a * math.cos(phi1) * math.cos(lambda1) + b * math.cos(phi2) * math.cos(lambda2)
    y = a * math.cos(phi1) * math.sin(lambda1) + b * math.cos(phi2) * math.sin(lambda2)
    z = a * math.sin(phi1) + b * math.sin(phi2)
    lat = math.degrees(math.atan2(z, math.sqrt(x * x + y * y)))
    lon = math.degrees(math.atan2(y, x))
    if lon > 180.0:
        lon -= 360.0
    if lon < -180.0:
        lon += 360.0
    return lat, lon
