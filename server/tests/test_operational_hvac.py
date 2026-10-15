from __future__ import annotations

import sys
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path


SERVER_DIR = Path(__file__).resolve().parents[1]
if str(SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(SERVER_DIR))

from operational_evidence import (  # noqa: E402
    Freshness,
    NumericObservation,
    Trend,
    derive_observed_trend,
    normalize_cps_node_evidence,
    normalize_people_snapshot,
)
from operational_hvac_policy import (  # noqa: E402
    OperationalHvacPolicy,
    OperationalRecommendation,
    evaluate_operational_hvac,
)
from operational_hvac_api import recommendation_response  # noqa: E402
from operational_hvac_service import (  # noqa: E402
    collect_and_evaluate_operational_hvac,
    collect_operational_evidence,
    evaluate_current_operational_hvac,
    policy_from_settings,
    previous_people_observation,
    previous_temperature_observation,
)
from people_snapshot import PeopleSnapshot  # noqa: E402


NOW = datetime(2026, 10, 10, 12, 0, tzinfo=timezone.utc)
LIMIT = timedelta(seconds=30)


def payload(*, temperature: float = 25.0, at: datetime = NOW, location: str = "A1-1", connection: str = "ONLINE", validation: str = "NORMAL"):
    stamp = at.isoformat()
    return {
        "node_id": "NODE-04", "location_id": location, "status": "ACTIVE", "connection_status": connection,
        "as_of": stamp, "last_heartbeat_received_at": stamp,
        "readings": [{"sensor_id": "TEMP-01", "sensor_type": "temperature", "value": temperature, "unit": "C", "timestamp": stamp, "validation_status": validation}],
    }


def snapshot(*, people: int = 10, at: datetime = NOW, zone: str = "A1.1", confidence: float | None = 0.8):
    return PeopleSnapshot("CAM-1", zone, int(at.timestamp() * 1000), people, people, confidence)


def approved_policy(*, preemptive: bool = False):
    # Explicit test-only parameters; production defaults remain unconfigured.
    return OperationalHvacPolicy("reviewed-test-policy", True, 30.0, 28.0, 1.0, 3, preemptive)


def trends(*, temp_previous: float = 25.0, temp_current: float = 26.0, people_previous: int = 10, people_current: int = 10):
    old = NOW - timedelta(seconds=10)
    return (
        derive_observed_trend(NumericObservation(temp_previous, old, "TEMP-01"), NumericObservation(temp_current, NOW, "TEMP-01")),
        derive_observed_trend(NumericObservation(people_previous, old, "CAM-1"), NumericObservation(people_current, NOW, "CAM-1")),
    )


class OperationalEvidenceTests(unittest.TestCase):
    def test_cps_freshness_mapping_and_sensor_validation(self):
        evidence = normalize_cps_node_evidence(payload(temperature=31), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertEqual(evidence.zone_id, "A1.1")
        self.assertEqual(evidence.snapshot_freshness, Freshness.FRESH)
        self.assertEqual(evidence.temperature.value_c, 31.0)
        self.assertEqual(evidence.temperature.validation_status, "NORMAL")

    def test_missing_stale_invalid_and_unmapped_data_are_explicit(self):
        stale = normalize_cps_node_evidence(payload(at=NOW - timedelta(seconds=31)), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertIn("CPS_SNAPSHOT_STALE", stale.issues)
        invalid = normalize_cps_node_evidence(payload(temperature=float("nan")), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertIn("TEMPERATURE_MISSING_OR_INVALID", invalid.issues)
        unmapped = normalize_cps_node_evidence(payload(location="X-9"), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertIn("ZONE_MAPPING_MISSING", unmapped.issues)

    def test_ai_snapshot_is_passive_and_confidence_is_not_count_accuracy(self):
        evidence = normalize_people_snapshot(snapshot(people=0, confidence=None), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertEqual(evidence.people_count, 0)
        self.assertIsNone(evidence.derived_detection_confidence)
        self.assertEqual(evidence.freshness, Freshness.FRESH)
        self.assertEqual(evidence.source, "live_ai")

    def test_missing_and_future_ai_snapshots_are_not_usable(self):
        missing = normalize_people_snapshot(None, evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertEqual(missing.freshness, Freshness.MISSING)
        future = normalize_people_snapshot(snapshot(at=NOW + timedelta(seconds=1)), evaluated_at=NOW, freshness_limit=LIMIT)
        self.assertEqual(future.freshness, Freshness.INVALID)

    def test_observed_trends_require_real_ordered_observations(self):
        increase = derive_observed_trend(NumericObservation(3, NOW - timedelta(seconds=2), "CAM-1"), NumericObservation(7, NOW, "CAM-1"))
        self.assertEqual((increase.direction, increase.delta), (Trend.INCREASING, 4))
        unknown = derive_observed_trend(None, NumericObservation(7, NOW, "CAM-1"))
        self.assertEqual(unknown.direction, Trend.UNKNOWN)


class OperationalHvacPolicyTests(unittest.TestCase):
    def evaluate(self, *, temperature=31.0, people=10, policy=None, temp_previous=29.0, people_previous=10, connection="ONLINE", zone="A1-1"):
        cps = normalize_cps_node_evidence(payload(temperature=temperature, location=zone, connection=connection), evaluated_at=NOW, freshness_limit=LIMIT)
        ai = normalize_people_snapshot(snapshot(people=people), evaluated_at=NOW, freshness_limit=LIMIT)
        temp_trend, crowd_trend = trends(temp_previous=temp_previous, temp_current=temperature, people_previous=people_previous, people_current=people)
        return evaluate_operational_hvac(cps, ai, temperature_trend=temp_trend, crowd_trend=crowd_trend, policy=policy or approved_policy())

    def test_reactive_elevated_temperature_with_stable_crowd(self):
        result = self.evaluate(temperature=31, temp_previous=30, people=10, people_previous=10)
        self.assertEqual(result.recommendation, OperationalRecommendation.VENTILATION_RECOMMENDED)
        self.assertEqual(result.reason_code, "REACTIVE_ELEVATED_TEMPERATURE_STABLE_CROWD")
        self.assertTrue(result.monitor_only)

    def test_predictive_observed_crowd_increase_does_not_claim_a_forecast_or_action(self):
        result = self.evaluate(temperature=27, temp_previous=27, people=14, people_previous=10)
        self.assertEqual(result.recommendation, OperationalRecommendation.ANTICIPATED_VENTILATION_DEMAND)
        self.assertEqual(result.reason_code, "OBSERVED_CROWD_INCREASE_NO_FORECAST_MODEL")

    def test_preemptive_recommendation_requires_explicit_approved_setting(self):
        result = self.evaluate(temperature=27, temp_previous=27, people=14, people_previous=10, policy=approved_policy(preemptive=True))
        self.assertEqual(result.recommendation, OperationalRecommendation.PREEMPTIVE_VENTILATION_RECOMMENDED)

    def test_combined_observed_rises_take_priority(self):
        result = self.evaluate(temperature=31, temp_previous=29, people=14, people_previous=10)
        self.assertEqual(result.recommendation, OperationalRecommendation.VENTILATION_RECOMMENDED)
        self.assertEqual(result.reason_code, "COMBINED_OBSERVED_TEMPERATURE_AND_CROWD_RISE")

    def test_unapproved_policy_is_disabled(self):
        result = self.evaluate(policy=OperationalHvacPolicy())
        self.assertEqual(result.recommendation, OperationalRecommendation.POLICY_NOT_CONFIGURED)

    def test_missing_conflicting_or_offline_evidence_is_insufficient(self):
        offline = self.evaluate(connection="OFFLINE")
        self.assertEqual(offline.recommendation, OperationalRecommendation.INSUFFICIENT_EVIDENCE)
        conflict = self.evaluate(zone="X-9")
        self.assertEqual(conflict.recommendation, OperationalRecommendation.INSUFFICIENT_EVIDENCE)
        self.assertIn("EVIDENCE_ZONE_CONFLICT", conflict.evidence_issues)

        cps = normalize_cps_node_evidence(payload(), evaluated_at=NOW, freshness_limit=LIMIT)
        missing_ai = normalize_people_snapshot(None, evaluated_at=NOW, freshness_limit=LIMIT)
        temp_trend, crowd_trend = trends()
        missing = evaluate_operational_hvac(cps, missing_ai, temperature_trend=temp_trend, crowd_trend=crowd_trend, policy=approved_policy())
        self.assertEqual(missing.recommendation, OperationalRecommendation.INSUFFICIENT_EVIDENCE)

    def test_simulation_engine_is_not_an_operational_dependency(self):
        result = self.evaluate()
        self.assertEqual(result.context, "real_operations")
        self.assertNotIn("sim", result.policy_version.lower())

    def test_service_reads_existing_sources_once_without_creating_history_or_commands(self):
        from people_snapshot import PeopleSnapshotCache

        cache = PeopleSnapshotCache()
        cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=int(NOW.timestamp() * 1000), people_count=10, people_smoothed=10, derived_detection_confidence=0.7)
        calls = 0

        def read_state():
            nonlocal calls
            calls += 1
            return payload(temperature=31)

        cps, ai = collect_operational_evidence(evaluated_at=NOW, cps_freshness_limit=LIMIT, ai_freshness_limit=LIMIT, fetch_cps_state=read_state, snapshot_cache=cache)
        self.assertEqual((calls, cps.node_id, ai.camera_id), (1, "NODE-04", "CAM-1"))
        result = evaluate_current_operational_hvac(evaluated_at=NOW, cps_freshness_limit=LIMIT, ai_freshness_limit=LIMIT, fetch_cps_state=read_state, snapshot_cache=cache, policy=approved_policy())
        self.assertEqual(calls, 2)
        self.assertEqual(result.recommendation, OperationalRecommendation.NO_RECOMMENDATION)
        self.assertEqual(result.crowd_trend.direction, Trend.UNKNOWN)

    def test_live_collection_timestamps_after_the_cps_read(self):
        """A CPS ``as_of`` generated during a read is not a future snapshot."""
        from people_snapshot import PeopleSnapshotCache

        cache = PeopleSnapshotCache()

        def read_state():
            observed_at = datetime.now(timezone.utc)
            cache.update(
                camera_id="CAM-1",
                zone_id="A1.1",
                observed_at=int(observed_at.timestamp() * 1000),
                people_count=1,
                people_smoothed=1,
                derived_detection_confidence=0.7,
            )
            return payload(at=observed_at)

        cps, ai = collect_operational_evidence(
            evaluated_at=None,
            cps_freshness_limit=LIMIT,
            ai_freshness_limit=LIMIT,
            fetch_cps_state=read_state,
            snapshot_cache=cache,
        )
        self.assertEqual(cps.snapshot_freshness, Freshness.FRESH)
        self.assertEqual(ai.freshness, Freshness.FRESH)

    def test_public_response_is_monitor_only_and_excludes_control_or_sensitive_fields(self):
        from people_snapshot import PeopleSnapshotCache

        cache = PeopleSnapshotCache()
        cache.update(camera_id="CAM-1", zone_id="A1.1", observed_at=int(NOW.timestamp() * 1000), people_count=10, people_smoothed=10, derived_detection_confidence=0.7)
        evaluation = collect_and_evaluate_operational_hvac(
            evaluated_at=NOW, cps_freshness_limit=LIMIT, ai_freshness_limit=LIMIT,
            fetch_cps_state=lambda: payload(), snapshot_cache=cache,
        )
        response = recommendation_response(evaluation)
        self.assertEqual(response["context"], "real_operations")
        self.assertTrue(response["monitor_only"])
        self.assertEqual(response["evaluation"]["status"], "POLICY_NOT_CONFIGURED")
        self.assertIsNone(response["evaluation"]["thresholds"])
        self.assertEqual(response["evidence"]["ai_people"]["people_count"], 10)
        approved = recommendation_response(collect_and_evaluate_operational_hvac(
            evaluated_at=NOW, cps_freshness_limit=LIMIT, ai_freshness_limit=LIMIT,
            fetch_cps_state=lambda: payload(), snapshot_cache=cache, policy=approved_policy(),
        ))
        self.assertEqual(approved["evaluation"]["thresholds"], {
            "reactive_temperature_c": 30.0, "normal_temperature_max_c": 28.0,
            "minimum_temperature_rise_c": 1.0, "minimum_crowd_increase": 3,
        })
        self.assertNotIn("network_observation", str(response))
        self.assertNotIn("relay", str(response))
        self.assertNotIn("command", str(response))


class ConfiguredPolicyAndTrendTests(unittest.TestCase):
    def test_single_sensor_unknown_is_accepted_only_when_enabled(self):
        cps = normalize_cps_node_evidence(payload(temperature=27, validation="UNKNOWN"), evaluated_at=NOW, freshness_limit=LIMIT)
        ai = normalize_people_snapshot(snapshot(), evaluated_at=NOW, freshness_limit=LIMIT)
        temp, crowd = trends(temp_previous=27, temp_current=27)
        strict = evaluate_operational_hvac(cps, ai, temperature_trend=temp, crowd_trend=crowd, policy=approved_policy())
        self.assertEqual(strict.recommendation, OperationalRecommendation.INSUFFICIENT_EVIDENCE)
        self.assertIn("TEMPERATURE_NOT_NORMAL", strict.evidence_issues)
        policy = policy_from_settings(approved=True, reactive_temperature_c="26", normal_temperature_max_c="25",
                                      minimum_temperature_rise_c="0.5", minimum_crowd_increase="3", accept_single_sensor_temperature=True)
        accepted = evaluate_operational_hvac(cps, ai, temperature_trend=temp, crowd_trend=crowd, policy=policy)
        self.assertEqual(accepted.recommendation, OperationalRecommendation.VENTILATION_RECOMMENDED)
        self.assertEqual(accepted.reason_code, "REACTIVE_ELEVATED_TEMPERATURE_STABLE_CROWD")

    def test_suspicious_temperature_is_never_accepted(self):
        cps = normalize_cps_node_evidence(payload(temperature=27, validation="SUSPICIOUS"), evaluated_at=NOW, freshness_limit=LIMIT)
        ai = normalize_people_snapshot(snapshot(), evaluated_at=NOW, freshness_limit=LIMIT)
        policy = policy_from_settings(approved=True, reactive_temperature_c="26", normal_temperature_max_c="25",
                                      minimum_temperature_rise_c="0.5", minimum_crowd_increase="3", accept_single_sensor_temperature=True)
        temp, crowd = trends()
        result = evaluate_operational_hvac(cps, ai, temperature_trend=temp, crowd_trend=crowd, policy=policy)
        self.assertEqual(result.recommendation, OperationalRecommendation.INSUFFICIENT_EVIDENCE)

    def test_policy_settings_stay_unconfigured_when_unapproved_or_malformed(self):
        unapproved = policy_from_settings(approved=False, reactive_temperature_c="26", normal_temperature_max_c="25",
                                          minimum_temperature_rise_c="0.5", minimum_crowd_increase="3", accept_single_sensor_temperature=False)
        malformed = policy_from_settings(approved=True, reactive_temperature_c="hot", normal_temperature_max_c="25",
                                         minimum_temperature_rise_c="0.5", minimum_crowd_increase="", accept_single_sensor_temperature=False)
        cps = normalize_cps_node_evidence(payload(), evaluated_at=NOW, freshness_limit=LIMIT)
        ai = normalize_people_snapshot(snapshot(), evaluated_at=NOW, freshness_limit=LIMIT)
        temp, crowd = trends()
        for policy in (unapproved, malformed):
            result = evaluate_operational_hvac(cps, ai, temperature_trend=temp, crowd_trend=crowd, policy=policy)
            self.assertEqual(result.recommendation, OperationalRecommendation.POLICY_NOT_CONFIGURED)

    def test_previous_people_comes_from_recorded_cache_history(self):
        from people_snapshot import PeopleSnapshotCache

        cache = PeopleSnapshotCache()
        ms = lambda at: int(at.timestamp() * 1000)  # noqa: E731
        cache.update(camera_id="CAM-C", zone_id="A1.1", observed_at=ms(NOW - timedelta(minutes=6)), people_count=4, people_smoothed=4)
        cache.update(camera_id="CAM-C", zone_id="A1.1", observed_at=ms(NOW - timedelta(minutes=2)), people_count=9, people_smoothed=9)
        previous = previous_people_observation(camera_id="CAM-C", now=NOW, lookback=timedelta(minutes=5), snapshot_cache=cache)
        self.assertEqual((previous.value, previous.source_id), (4.0, "CAM-C"))
        self.assertIsNone(previous_people_observation(camera_id="CAM-C", now=NOW, lookback=timedelta(minutes=10), snapshot_cache=cache))

    def test_previous_temperature_is_newest_reading_before_lookback(self):
        seen = {}

        def history(**kwargs):
            seen.update(kwargs)
            return {"items": [
                {"timestamp": (NOW - timedelta(seconds=330)).isoformat(), "value": 24.0},
                {"timestamp": (NOW - timedelta(seconds=305)).isoformat(), "value": 24.5},
            ]}

        previous = previous_temperature_observation(sensor_id="TEMP-01", now=NOW, lookback=timedelta(minutes=5), fetch_history=history)
        self.assertEqual((previous.value, previous.source_id), (24.5, "TEMP-01"))
        self.assertEqual(seen["end"], NOW - timedelta(minutes=5))
        self.assertIsNone(previous_temperature_observation(sensor_id="TEMP-01", now=NOW, lookback=timedelta(minutes=5), fetch_history=lambda **_: {"items": []}))


if __name__ == "__main__":
    unittest.main()
