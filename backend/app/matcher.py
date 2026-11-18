"""Pick songs whose tempo matches each segment's cadence and whose lengths add
up to the segment's length, keeping the music in step with the workout."""
from __future__ import annotations

import random
from itertools import combinations
from typing import Literal, Optional

from pydantic import BaseModel, Field

from .workout import Segment


class Track(BaseModel):
    id: str
    uri: str
    name: str
    artists: list[str] = []
    duration_s: float
    tempo: Optional[float] = None
    energy: Optional[float] = None
    image: Optional[str] = None
    source: Literal["liked", "playlist", "new"] = "liked"


class PlanOptions(BaseModel):
    library_only: bool = False
    tolerance_pct: float = Field(3.0, description="How far song BPM may be from cadence")
    allow_half_time: bool = True  # a 85 BPM song works for 170 steps/min
    max_tracks_per_block: int = 4
    merge_under_s: float = Field(150, description="Fold segments shorter than this into a neighbour")
    seed: int = 0


class Pick(BaseModel):
    track: Track
    effective_bpm: float  # tempo after half/double-time
    multiplier: float
    bpm_off_pct: float
    starts_at_s: float


class Block(BaseModel):
    label: str
    group: str
    segment_indices: list[int]
    start_s: float
    duration_s: float
    target_bpm: float
    picks: list[Pick] = []
    music_s: float = 0
    drift_end_s: float = 0  # music end minus segment end; + means music runs long
    tolerance_used_pct: float = 0
    note: Optional[str] = None


class Plan(BaseModel):
    blocks: list[Block]
    total_workout_s: float
    total_music_s: float
    pool_size: int
    tempo_known: int


def build_blocks(segments: list[Segment], merge_under_s: float) -> list[Block]:
    """Fold short segments (like a 90s walking rest) into a neighbour, since no
    song is that short."""
    groups: list[list[int]] = [[i] for i in range(len(segments))]
    changed = True
    while changed and len(groups) > 1:
        changed = False
        for gi, g in enumerate(groups):
            dur = sum(segments[i].duration_s for i in g)
            if dur < merge_under_s:
                # rests join the step before them; otherwise join the next step
                is_rest = all(segments[i].kind == "rest" for i in g)
                if (is_rest and gi > 0) or gi == len(groups) - 1:
                    groups[gi - 1].extend(g)
                else:
                    groups[gi + 1][:0] = g
                groups.pop(gi)
                changed = True
                break

    blocks, t = [], 0.0
    for g in groups:
        segs = [segments[i] for i in g]
        dur = sum(s.duration_s for s in segs)
        main = max(segs, key=lambda s: s.duration_s)
        label = " + ".join(s.label for s in segs)
        blocks.append(
            Block(
                label=label,
                group=main.group,
                segment_indices=g,
                start_s=t,
                duration_s=dur,
                target_bpm=main.cadence,
            )
        )
        t += dur
    return blocks


def tempo_fit(tempo: float, target: float, allow_half: bool) -> tuple[float, float]:
    """Best (multiplier, fractional error) for playing `tempo` against `target`."""
    mults = [1.0, 2.0, 0.5] if allow_half else [1.0]
    best = min(mults, key=lambda m: abs(tempo * m - target))
    return best, abs(tempo * best - target) / target


def plan_playlist(segments: list[Segment], tracks: list[Track], opt: PlanOptions) -> Plan:
    rng = random.Random(opt.seed)
    pool = [t for t in tracks if t.tempo and t.duration_s > 60]
    if opt.library_only:
        pool = [t for t in pool if t.source != "new"]
    used: set[str] = set()
    blocks = build_blocks(segments, opt.merge_under_s)
    intensities = [segments[b.segment_indices[0]].intensity for b in blocks]

    music_t = 0.0
    for b, intensity in zip(blocks, intensities):
        seg_end = b.start_s + b.duration_s
        need = seg_end - music_t  # catch up (or wait out) drift from earlier blocks
        if need < 45:
            b.note = "Skipped: the previous songs already cover this stretch."
            b.drift_end_s = round(music_t - seg_end)
            continue

        want_energy = 0.45 + 0.45 * intensity
        tol = opt.tolerance_pct / 100
        cands: list[tuple[float, Track, float, float]] = []
        max_tol = max(tol * 2, 0.06)  # never stray further than this from the cadence
        for attempt in range(5):
            cands = []
            for t in pool:
                if t.id in used:
                    continue
                mult, err = tempo_fit(t.tempo, b.target_bpm, opt.allow_half_time)
                if err > tol:
                    continue
                energy_gap = abs((t.energy if t.energy is not None else want_energy) - want_energy)
                score = err * 100 + energy_gap * 3 + rng.random() * 1.5
                cands.append((score, t, mult, err))
            if len(cands) >= 3 or tol >= max_tol:
                break
            tol = min(tol * 1.5, max_tol)
        b.tolerance_used_pct = round(tol * 100, 1)
        if tol * 100 > opt.tolerance_pct + 0.01:
            b.note = f"Few close matches, widened BPM range to ±{tol * 100:.1f}%."
        if not cands:
            b.note = "No songs in your pool near this BPM. Add more music or widen the range."
            b.drift_end_s = round(music_t - seg_end)
            continue

        cands.sort(key=lambda c: c[0])
        top = cands[:18]
        best, best_cost = None, float("inf")
        for k in range(1, opt.max_tracks_per_block + 1):
            for combo in combinations(top, k):
                total = sum(c[1].duration_s for c in combo)
                off_pct = abs(total - need) / need * 100
                cost = off_pct * 1.2 + sum(c[0] for c in combo) / k
                if cost < best_cost:
                    best, best_cost = combo, cost
        assert best is not None
        # build energy within a block: calmer songs first
        ordered = sorted(best, key=lambda c: (c[1].energy or 0, c[1].tempo))
        start = music_t
        for _, t, mult, err in ordered:
            used.add(t.id)
            b.picks.append(
                Pick(
                    track=t,
                    effective_bpm=round(t.tempo * mult, 1),
                    multiplier=mult,
                    bpm_off_pct=round(err * 100, 1),
                    starts_at_s=round(music_t),
                )
            )
            music_t += t.duration_s
        b.music_s = round(music_t - start)
        b.drift_end_s = round(music_t - seg_end)

    return Plan(
        blocks=blocks,
        total_workout_s=round(sum(s.duration_s for s in segments)),
        total_music_s=round(music_t),
        pool_size=len(tracks) if not opt.library_only else len([t for t in tracks if t.source != "new"]),
        tempo_known=len(pool),
    )
