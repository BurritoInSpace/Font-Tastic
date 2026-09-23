from fonttastic.naming import category_for, parse_filename


def test_encoded_glyph():
    p = parse_filename("uni05D0")
    assert (p.glyph_name, p.unicode, p.suffix, p.components) == ("uni05D0", 0x05D0, None, ())
    assert category_for(p) == "base"


def test_alternate_is_unencoded_and_names_its_feature():
    p = parse_filename("uni05D1.salt")
    assert p.unicode is None
    assert p.base_name == "uni05D1"
    assert p.alternate_feature == "salt"
    assert parse_filename("uni05D1.ss03").alternate_feature == "ss03"
    assert parse_filename("uni05D1.alt2").alternate_feature is None


def test_ligature():
    p = parse_filename("uni05D0_uni05DC.liga")
    assert p.components == ("uni05D0", "uni05DC")
    assert p.unicode is None
    assert p.alternate_feature is None
    assert category_for(p) == "ligature"


def test_niqqud_is_mark():
    assert category_for(parse_filename("uni05B7")) == "mark"
    assert category_for(parse_filename("uni05BC.salt")) == "mark"


def test_master_suffix_split_off():
    p = parse_filename("uni05D0-Bold")
    assert (p.glyph_name, p.master, p.unicode) == ("uni05D0", "Bold", 0x05D0)


def test_notdef_and_agl_names():
    assert parse_filename(".notdef").glyph_name == ".notdef"
    assert parse_filename("space").unicode == 0x20
