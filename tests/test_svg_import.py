import pytest

from fonttastic.svg_import import _signed_area, parse_svg

ASC, DESC = 800, -200


def svg(body, w=600):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 1000">{body}</svg>'.encode()


def bbox(contour):
    pts = [args[-1] for _, args in contour if args]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))


def test_artboard_maps_to_em_box():
    # artboard top = ascender, 800 units down = baseline
    out = parse_svg(svg('<rect x="100" y="100" width="200" height="700"/>'), ASC, DESC)
    assert out.advance == 600
    assert [bbox(c) for c in out.contours] == [(100, 0, 300, 700)]


def test_artboard_scale():
    out = parse_svg(
        b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 500"><rect x="0" y="400" width="10" height="100"/></svg>',
        ASC, DESC,
    )
    assert out.advance == 600
    assert bbox(out.contours[0]) == (0, -200, 20, 0)


def test_group_transforms_compose():
    body = '<g transform="translate(100 0)"><g transform="scale(2)"><rect x="0" y="300" width="50" height="50"/></g></g>'
    out = parse_svg(svg(body), ASC, DESC)
    assert bbox(out.contours[0]) == (100, 100, 200, 200)


def test_overlapping_shapes_are_kept_as_drawn_and_wind_alike():
    # merged only on static export; kept separate so weights stay point-compatible
    body = '<rect x="0" y="100" width="300" height="100"/><rect x="200" y="100" width="100" height="700"/>'
    out = parse_svg(svg(body), ASC, DESC)
    assert len(out.contours) == 2
    assert all(_signed_area(c) > 0 for c in out.contours)  # both counter-clockwise: they fill as a union


def test_shapes_drawn_either_way_are_normalised():
    ccw = '<path d="M0,100 H400 V800 H0 Z"/>'
    cw = '<path d="M500,100 V800 H900 V100 Z"/>'
    out = parse_svg(svg(ccw + cw, w=1000), ASC, DESC)
    assert all(_signed_area(c) > 0 for c in out.contours)


def test_nonzero_compound_hole_stays_a_hole():
    # outer drawn one way, counter drawn the other: a hole under nonzero filling
    body = '<path d="M0,100 H400 V800 H0 Z M100,200 V700 H300 V200 Z"/>'
    out = parse_svg(svg(body), ASC, DESC)
    areas = sorted(_signed_area(c) for c in out.contours)
    assert areas[0] < 0 < areas[1]


def test_evenodd_counter_becomes_a_hole():
    body = '<path style="fill-rule:evenodd" d="M0,100 H400 V800 H0 Z M100,200 H300 V700 H100 Z"/>'
    out = parse_svg(svg(body), ASC, DESC)
    areas = sorted(_signed_area(c) for c in out.contours)
    assert len(areas) == 2 and areas[0] < 0 < areas[1]


def test_css_class_fill_rule_and_hidden_layers():
    body = (
        "<style>.eo{fill-rule:evenodd} .off{display:none}</style>"
        '<path class="eo" d="M0,100 H400 V800 H0 Z M100,200 H300 V700 H100 Z"/>'
        '<g class="off"><rect x="500" y="0" width="50" height="50"/></g>'
    )
    out = parse_svg(svg(body), ASC, DESC)
    assert len(out.contours) == 2
    assert all(bbox(c)[2] <= 400 for c in out.contours)


def test_illustrator_switch_wrapper_and_private_data():
    body = (
        '<switch><foreignObject requiredExtensions="x"><rect x="0" y="0" width="999" height="999"/></foreignObject>'
        '<g><rect x="100" y="100" width="100" height="700"/></g></switch>'
    )
    out = parse_svg(svg(body), ASC, DESC)
    assert [bbox(c) for c in out.contours] == [(100, 0, 200, 700)]


def test_stroke_only_paths_warn():
    out = parse_svg(svg('<path d="M0,0 L100,100" fill="none" stroke="#000"/>'), ASC, DESC)
    assert out.contours == []
    assert any("Outline Stroke" in w for w in out.warnings)


def test_missing_viewbox_is_an_error():
    with pytest.raises(ValueError):
        parse_svg(b'<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>', ASC, DESC)


def on_curve_count(out):
    from fonttastic import resequence

    return [sum(p[2] is not None for p in c) for c in resequence.collect(out.draw_points)]


def small(body, w="8.4"):
    """A 10 px tall artboard, like a glyph drawn at 10 pt: 1 px = 100 font units."""
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} 10"><path d="{body}"/></svg>'.encode()


def test_closing_curve_that_stops_short_is_one_point_not_two():
    # Illustrator's export: the closing curve ends 0.01 px (1 unit) off the start.
    closed = parse_svg(small("M1,1 H5 V5 C5,7 3,8 1.01,8.01 C0,6 0,3 1.01,1.01 Z"), ASC, DESC)
    assert on_curve_count(closed) == [4]
    assert closed.warnings == []


def test_closing_line_back_to_start_is_not_a_point():
    out = parse_svg(small("M1,1 L5,1 L5,5 L1,5 L1.01,1.01 Z"), ASC, DESC)
    assert on_curve_count(out) == [4]


def test_real_closing_segment_is_kept():
    out = parse_svg(small("M1,1 L5,1 L5,5 L1,5 L1,1.5 Z"), ASC, DESC)  # 50 units short: a real point
    assert on_curve_count(out) == [5]


def test_coarse_rounding_is_reported():
    out = parse_svg(small("M1.1,1 L5,1 L5,5 L1,5 Z"), ASC, DESC)  # 1 decimal on a 10 px artboard
    assert len(out.warnings) == 1 and "rounded to 10 font units" in out.warnings[0]
    assert parse_svg(small("M1.12,1 L5,1 L5,5 L1,5 Z"), ASC, DESC).warnings == []
