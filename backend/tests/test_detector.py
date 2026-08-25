"""
Tests for the YOLO proctoring detector's multiple-persons logic.

False "multiple_persons" alerts were caused by:
    1. duplicate overlapping person boxes on the SAME person being counted
       individually (YOLO emits full-body + upper-body boxes),
    2. low-confidence person boxes (reflections, posters) passing the model
       threshold and inflating the count.

The fix: person boxes must clear a higher confidence floor, then go through
greedy IoU dedup before `person_count` is computed. Phone handling is
unchanged.
"""

import os
import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # tests/
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # backend/

import numpy as np  # noqa: E402

from app.proctoring.detector import (  # noqa: E402
    ProctorDetector,
    _dedupe,
    _iou,
)


PERSON_ID = 0
PHONE_ID = 67


def _person(conf, bbox):
    return {"class_id": PERSON_ID, "label": "person", "confidence": conf, "bbox": bbox}


def test_iou_identical_boxes_is_one():
    box = [0, 0, 100, 100]
    assert _iou(box, box) == 1.0


def test_iou_disjoint_boxes_is_zero():
    assert _iou([0, 0, 10, 10], [50, 50, 60, 60]) == 0.0


def test_iou_half_overlap():
    # Two 100x100 boxes offset by 50px share 50x100 = 5000 of 15000 union area.
    iou = _iou([0, 0, 100, 100], [50, 0, 150, 100])
    assert abs(iou - 1 / 3) < 1e-6


def test_duplicate_overlapping_persons_collapse_to_one():
    dets = [
        _person(0.9, [0, 0, 200, 400]),
        _person(0.7, [5, 5, 205, 405]),   # near-identical duplicate box
    ]
    assert len(_dedupe(dets, iou_threshold=0.5)) == 1


def test_two_distinct_people_both_kept():
    dets = [
        _person(0.9, [0, 0, 200, 400]),
        _person(0.8, [400, 0, 600, 400]),  # separate region of the frame
    ]
    assert len(_dedupe(dets, iou_threshold=0.5)) == 2


def test_lower_conf_box_dropped_when_overlapping_higher_conf():
    dets = [
        _person(0.70, [0, 0, 200, 400]),
        _person(0.90, [10, 10, 210, 410]),
    ]
    kept = _dedupe(dets, iou_threshold=0.5)
    assert len(kept) == 1
    assert kept[0]["confidence"] == 0.90


class _FakeBoxes:
    def __init__(self, rows):
        self.rows = rows

    def __iter__(self):
        return iter(self.rows)


class _FakeResult:
    def __init__(self, rows):
        self.boxes = _FakeBoxes(rows)


class _FakeModel:
    """Mimics ultralytics YOLO: callable(frame)[0] -> result with .boxes/.names."""

    def __init__(self, rows):
        self.rows = rows
        self.names = {PERSON_ID: "person", PHONE_ID: "cell phone"}

    def __call__(self, frame, conf=None, verbose=False):
        return [_FakeResult(self.rows)]


def _detector_with(rows):
    det = ProctorDetector.__new__(ProctorDetector)
    det.model = _FakeModel(rows)
    det.conf_threshold = 0.50
    det.person_conf_threshold = 0.65
    det.person_dedup_iou = 0.50
    det.sessions = {}
    det.person_class_id = PERSON_ID
    det.phone_class_id = PHONE_ID
    return det


def _row(cls, conf, bbox):
    return {"cls": cls, "conf": conf, "bbox": bbox}


def _make_result(detector, raw_rows):
    class _Box:
        def __init__(self, row):
            self._row = row

        @property
        def cls(self):
            return np.array([self._row["cls"]])

        @property
        def conf(self):
            return np.array([self._row["conf"]])

        @property
        def xyxy(self):
            return np.array([self._row["bbox"]])

    detector.model.rows = [_Box(r) for r in raw_rows]
    frame = np.zeros((480, 640, 3), dtype=np.uint8)
    return detector.process_frame("sess", frame)


def test_single_person_with_duplicate_boxes_not_flagged():
    det = _detector_with([])
    result = _make_result(det, [
        _row(PERSON_ID, 0.90, [0, 0, 200, 400]),
        _row(PERSON_ID, 0.75, [8, 4, 208, 404]),
    ])
    assert result["person_count"] == 1
    assert not any(a["type"] == "multiple_persons" for a in result["alerts"])


def test_two_separate_people_still_flagged():
    det = _detector_with([])
    result = _make_result(det, [
        _row(PERSON_ID, 0.90, [0, 0, 200, 400]),
        _row(PERSON_ID, 0.85, [420, 0, 620, 400]),
    ])
    assert result["person_count"] == 2
    assert any(a["type"] == "multiple_persons" for a in result["alerts"])


def test_low_confidence_second_box_ignored():
    det = _detector_with([])
    result = _make_result(det, [
        _row(PERSON_ID, 0.90, [0, 0, 200, 400]),
        _row(PERSON_ID, 0.55, [420, 0, 620, 400]),  # below 0.65 person floor
    ])
    assert result["person_count"] == 1
    assert not any(a["type"] == "multiple_persons" for a in result["alerts"])


def test_phone_detection_unaffected():
    det = _detector_with([])
    result = _make_result(det, [
        _row(PERSON_ID, 0.90, [0, 0, 200, 400]),
        _row(PHONE_ID, 0.55, [300, 300, 340, 360]),  # below person floor, still a phone
    ])
    assert result["phone_detected"] is True
    assert result["person_count"] == 1
    assert any(a["type"] == "phone_detected" for a in result["alerts"])


if __name__ == "__main__":
    test_iou_identical_boxes_is_one()
    print("PASS iou identical")
    test_iou_disjoint_boxes_is_zero()
    print("PASS iou disjoint")
    test_iou_half_overlap()
    print("PASS iou half overlap")
    test_duplicate_overlapping_persons_collapse_to_one()
    print("PASS duplicates collapse")
    test_two_distinct_people_both_kept()
    print("PASS distinct people kept")
    test_lower_conf_box_dropped_when_overlapping_higher_conf()
    print("PASS lower conf dropped")
    test_single_person_with_duplicate_boxes_not_flagged()
    print("PASS single person not flagged")
    test_two_separate_people_still_flagged()
    print("PASS two people flagged")
    test_low_confidence_second_box_ignored()
    print("PASS low conf ignored")
    test_phone_detection_unaffected()
    print("PASS phone unaffected")
