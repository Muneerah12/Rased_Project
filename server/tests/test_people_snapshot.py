from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

import cameras  # noqa: E402
from people_snapshot import PeopleSnapshotCache, derived_person_detection_confidence  # noqa: E402


class PeopleSnapshotCacheTests(unittest.TestCase):
    def test_confidence_is_median_of_current_person_scores(self):
        self.assertEqual(
            derived_person_detection_confidence([
                {"model": "people", "label": "person", "score": 0.2},
                {"model": "people", "label": "person", "score": 0.8},
                {"model": "fire", "label": "fire", "score": 0.99},
                {"model": "wrong_way", "label": "Wrong way", "score": 0.6},
                {"model": "people", "label": "person", "score": "bad"},
            ]),
            0.6,
        )

    def test_zero_people_has_no_derived_confidence(self):
        self.assertIsNone(derived_person_detection_confidence([]))
        cache = PeopleSnapshotCache()
        cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=100, people_count=0)
        snapshot = cache.get("CAM-1")
        self.assertIsNotNone(snapshot)
        self.assertEqual(snapshot.people_count, 0)
        self.assertIsNone(snapshot.derived_detection_confidence)

    def test_cache_is_bounded_isolated_and_returns_immutable_values(self):
        cache = PeopleSnapshotCache(max_entries=2)
        cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=100, people_count=1)
        cache.update(camera_id="CAM-2", zone_id="A1.2", observed_at=200, people_count=2)
        first = cache.get("CAM-1")
        self.assertEqual(first.zone_id, "A1.1")
        with self.assertRaises(Exception):
            first.people_count = 99  # type: ignore[misc]
        cache.update(camera_id="CAM-3", zone_id="A1.3", observed_at=300, people_count=3)
        self.assertIsNone(cache.get("CAM-1"))
        self.assertEqual(cache.get("CAM-2").people_count, 2)
        self.assertEqual(cache.get("CAM-3").people_count, 3)

    def test_removal_and_stale_cleanup(self):
        cache = PeopleSnapshotCache()
        cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=100, people_count=1)
        cache.update(camera_id="CAM-2", zone_id="A1.2", observed_at=200, people_count=2)
        self.assertEqual(cache.clear_stale(200), 1)
        self.assertIsNone(cache.get("CAM-1"))
        cache.remove("CAM-2")
        self.assertIsNone(cache.get("CAM-2"))

    def test_malformed_data_is_ignored(self):
        cache = PeopleSnapshotCache()
        self.assertIsNone(cache.update(camera_id="", zone_id="A1.1", observed_at=1, people_count=1))
        self.assertIsNone(cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at="bad", people_count=1))
        self.assertIsNone(cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=1, people_count=-1))


class CameraRuntimeSnapshotTests(unittest.TestCase):
    def test_completed_result_updates_cache_without_additional_inference(self):
        cache = PeopleSnapshotCache()
        runtime = cameras.CameraRuntime({"id": "CAM-1", "zone_id": "A1.1", "models": ["people"], "counts_zone": False})
        runtime.source = "stream"
        completed_result = {
            "people_count": 2,
            "detections": [
                {"model": "people", "label": "person", "score": 0.4},
                {"model": "people", "label": "person", "score": 0.8},
            ],
            "alerts": [],
        }
        with patch.object(cameras, "people_snapshot_cache", cache), \
             patch.object(runtime, "analyze", side_effect=AssertionError("must not infer")), \
             patch.object(cameras.hub, "publish") as publish, \
             patch.object(cameras, "now_ms", return_value=1_234_567):
            returned = runtime.handle_result(completed_result, np.zeros((2, 2, 3), dtype=np.uint8))
        snapshot = cache.get("CAM-1")
        self.assertEqual(returned["people_smoothed"], 2)
        self.assertEqual(snapshot.camera_id, "CAM-1")
        self.assertEqual(snapshot.zone_id, "A1.1")
        self.assertEqual(snapshot.observed_at, 1_234_567)
        self.assertEqual(snapshot.people_count, 2)
        self.assertEqual(snapshot.people_smoothed, 2)
        self.assertAlmostEqual(snapshot.derived_detection_confidence, 0.6)
        self.assertEqual(snapshot.source, "live_ai")
        frame_message = next(call.args[0] for call in publish.call_args_list if call.args[0].get("type") == "frame")
        self.assertEqual(frame_message["people"], 2)
        self.assertEqual(frame_message["people_smoothed"], 2)
        self.assertEqual(frame_message["camera_id"], "CAM-1")

    def test_malformed_completed_result_does_not_interrupt_camera_processing(self):
        cache = PeopleSnapshotCache()
        runtime = cameras.CameraRuntime({"id": "CAM-1", "zone_id": "A1.1", "models": [], "counts_zone": False})
        with patch.object(cameras, "people_snapshot_cache", cache), patch.object(cameras.hub, "publish"):
            returned = runtime.handle_result({"people_count": 0, "detections": "bad", "alerts": []}, np.zeros((2, 2, 3), dtype=np.uint8))
        self.assertIn("events", returned)
        snapshot = cache.get("CAM-1")
        self.assertEqual(snapshot.people_count, 0)
        self.assertIsNone(snapshot.derived_detection_confidence)


if __name__ == "__main__":
    unittest.main()
