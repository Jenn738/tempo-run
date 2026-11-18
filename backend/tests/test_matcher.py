import random

from app.matcher import PlanOptions, Track, build_blocks, plan_playlist, tempo_fit
from app.workout import RunnerProfile, parse_workout_text
from tests.test_workout import RUNNA


def make_pool(n=400, seed=1, source="liked"):
    rng = random.Random(seed)
    return [
        Track(
            id=f"{source}{i}",
            uri=f"spotify:track:{source}{i}",
            name=f"Song {i}",
            duration_s=rng.uniform(150, 260),
            tempo=rng.uniform(75, 185),
            energy=rng.random(),
            source=source,
        )
        for i in range(n)
    ]


def test_half_time_counts():
    assert tempo_fit(84, 168, True) == (2.0, 0.0)
    assert tempo_fit(84, 168, False)[0] == 1.0


def test_rest_folds_into_previous_step():
    segs = parse_workout_text(RUNNA, RunnerProfile())
    blocks = build_blocks(segs, 150)
    assert len(blocks) == 5
    assert blocks[3].segment_indices == [3, 4]


def test_plan_matches_bpm_and_stays_in_sync():
    segs = parse_workout_text(RUNNA, RunnerProfile())
    plan = plan_playlist(segs, make_pool(), PlanOptions())
    ids = [p.track.id for b in plan.blocks for p in b.picks]
    assert len(ids) == len(set(ids)), "no repeats"
    for b in plan.blocks:
        assert b.picks
        for p in b.picks:
            assert p.bpm_off_pct <= 3.0
        assert abs(b.drift_end_s) < 60, b
    assert abs(plan.total_music_s - plan.total_workout_s) < 60


def test_library_only_excludes_new_songs():
    segs = parse_workout_text(RUNNA, RunnerProfile())
    pool = make_pool(200) + make_pool(400, seed=2, source="new")
    plan = plan_playlist(segs, pool, PlanOptions(library_only=True))
    assert all(p.track.source != "new" for b in plan.blocks for p in b.picks)


def test_sparse_pool_widens_range_and_explains():
    segs = parse_workout_text("5 min at 7:00/mi", RunnerProfile())
    pool = [Track(id="a", uri="u", name="a", duration_s=300, tempo=150, source="liked")]
    plan = plan_playlist(segs, pool, PlanOptions())
    assert plan.blocks[0].note
