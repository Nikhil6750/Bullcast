"""Tests for fingerprint: same inputs → same hash, any change flips it."""
import pytest

from backend.algo.advanced.fingerprint import compute_fingerprint


def test_same_inputs_same_hash():
    h1 = compute_fingerprint("model_v1", "pipe_abc123", "rules_xyz")
    h2 = compute_fingerprint("model_v1", "pipe_abc123", "rules_xyz")
    assert h1 == h2


def test_hash_is_16_chars():
    h = compute_fingerprint("a", "b", "c")
    assert len(h) == 16


def test_different_model_version_changes_hash():
    h1 = compute_fingerprint("model_v1", "pipe_abc", "rules_xyz")
    h2 = compute_fingerprint("model_v2", "pipe_abc", "rules_xyz")
    assert h1 != h2


def test_different_pipeline_version_changes_hash():
    h1 = compute_fingerprint("model_v1", "pipe_aaa", "rules_xyz")
    h2 = compute_fingerprint("model_v1", "pipe_bbb", "rules_xyz")
    assert h1 != h2


def test_different_rules_hash_changes_hash():
    h1 = compute_fingerprint("model_v1", "pipe_abc", "rules_aaa")
    h2 = compute_fingerprint("model_v1", "pipe_abc", "rules_bbb")
    assert h1 != h2


def test_all_empty_strings_stable():
    h1 = compute_fingerprint("", "", "")
    h2 = compute_fingerprint("", "", "")
    assert h1 == h2
    assert len(h1) == 16
