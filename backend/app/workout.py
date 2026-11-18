"""Workouts: parse pasted workout text or Strava laps into timed segments, and
work out a target step cadence (= target song BPM) for each one."""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, Field

METERS_PER = {"mi": 1609.344, "km": 1000.0, "m": 1.0}


class RunnerProfile(BaseModel):
    """How fast this runner's feet turn over at a given pace."""

    unit: Literal["mi", "km"] = "mi"
    easy_pace_s: float = Field(630, description="Conversational pace, seconds per unit")
    easy_cadence: float = Field(162, description="Steps per minute at easy pace")
    cadence_gain: float = Field(
        8, description="Extra steps per minute for each minute-per-unit faster"
    )
    walk_cadence: float = 115


class Segment(BaseModel):
    label: str
    kind: Literal["run", "rest"] = "run"
    group: str = "Main"
    duration_s: float
    distance_m: Optional[float] = None
    pace_s: Optional[float] = Field(None, description="Seconds per profile unit")
    cadence: float = 0  # target steps per minute = target BPM
    cadence_source: Literal["pace", "strava", "manual"] = "pace"
    intensity: float = 0.0  # 0 = easy, 1 = hardest step in this workout


def cadence_for_pace(pace_s: float, p: RunnerProfile) -> float:
    faster_by_min = (p.easy_pace_s - pace_s) / 60.0
    return max(120.0, min(200.0, p.easy_cadence + faster_by_min * p.cadence_gain))


def finalize(segments: list[Segment], p: RunnerProfile) -> list[Segment]:
    """Fill in cadence and intensity from pace where they aren't set."""
    for s in segments:
        if s.cadence_source == "pace" or not s.cadence:
            if s.kind == "rest":
                s.cadence = p.walk_cadence
            else:
                s.cadence = round(cadence_for_pace(s.pace_s or p.easy_pace_s, p), 1)
            s.cadence_source = "pace"
    run_paces = [s.pace_s for s in segments if s.kind == "run" and s.pace_s]
    if run_paces:
        slow, fast = max(run_paces), min(run_paces)
        span = max(slow - fast, 1.0)
        for s in segments:
            if s.kind == "run" and s.pace_s:
                s.intensity = round((slow - s.pace_s) / span, 2) if slow != fast else 0.5
    return segments


# --------------------------------------------------------------- text parsing
_NUM = r"(\d+(?:\.\d+)?)"
PACE_RE = re.compile(r"(\d{1,2}):(\d{2})\s*/\s*(mi|mile|km)\b", re.I)
DIST_RE = re.compile(_NUM + r"\s*(mi|miles?|km|k|m|meters?|metres?)\b(?!\s*/)", re.I)
TIME_RE = re.compile(_NUM + r"\s*(s|secs?|seconds?|min|mins|minutes?|hr|hours?)\b", re.I)
REST_RE = re.compile(
    _NUM + r"\s*(s|secs?|seconds?|min|mins|minutes?)\s+(?:of\s+)?"
    r"(?:walking|standing|jogging|easy|active)?\s*(?:rest|recovery|recover|walk)\b",
    re.I,
)
REPEAT_RE = re.compile(r"(?:repeat\s*)?(?:(\d+)\s*(?:x|×|times)\b|[x×]\s*(\d+)\b)", re.I)
HEADER_RE = re.compile(
    r"^\s*(warm[\s-]?up|cool[\s-]?down|session|main\s*set|intervals?|repeats?|set\s*\d*)"
    r"\b(.*)$",
    re.I,
)
EASY_RE = re.compile(r"\b(conversational|easy|recovery pace|comfortable)\b", re.I)
CAP_RE = re.compile(r"no\s+faster\s+than\s+(\d{1,2}):(\d{2})\s*/\s*(mi|mile|km)", re.I)


def _unit_key(u: str) -> str:
    u = u.lower()
    if u.startswith("mi"):
        return "mi"
    if u in ("km", "k"):
        return "km"
    return "m"


def _secs(value: float, unit: str) -> float:
    u = unit.lower()
    if u.startswith("h"):
        return value * 3600
    if u.startswith("m"):
        return value * 60
    return value


def _pace_to_profile(minutes: int, seconds: int, unit: str, p: RunnerProfile) -> float:
    per_m = (minutes * 60 + seconds) / METERS_PER[_unit_key(unit)]
    return per_m * METERS_PER[p.unit]


def _group_name(header: str) -> str:
    h = header.lower().replace("-", " ").replace("  ", " ")
    if h.startswith("warm"):
        return "Warm-Up"
    if h.startswith("cool"):
        return "Cool Down"
    return "Session"


def parse_workout_text(text: str, p: RunnerProfile) -> list[Segment]:
    """Read Runna/Strava-style workout steps, one per line, e.g.

        Warm-Up
        0.5mi at a conversational pace
        No faster than 10:25/mi
        Session
        1mi at 9:05/mi
        1mi at 8:55/mi 90s walking rest
        Cool Down
        0.5mi easy

    A header like "Session x3" or "Repeat 3 times" repeats the steps under it.
    """
    blocks: list[tuple[str, int, list[Segment]]] = []
    group, repeat, steps = "Main", 1, []

    def flush():
        nonlocal steps
        if steps:
            blocks.append((group, repeat, steps))
        steps = []

    last: Optional[Segment] = None
    last_was_easy = False

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        line = re.sub(r"\b(RUN|REST)\s*$", "", line).strip()  # Runna's step-type labels
        line = re.sub(r"^\d{1,2}[.)]?\s+(?=\d)", "", line)  # leading step numbers
        if re.fullmatch(r"\d{1,2}", line):
            continue

        header = HEADER_RE.match(line)
        if header and not DIST_RE.search(line) and not PACE_RE.search(line):
            flush()
            group = _group_name(header.group(1))
            rep = REPEAT_RE.search(header.group(2) or "")
            repeat = int(rep.group(1) or rep.group(2)) if rep else 1
            continue

        rep_line = REPEAT_RE.fullmatch(line)
        if rep_line:
            flush()
            repeat = int(rep_line.group(1) or rep_line.group(2))
            continue

        cap = CAP_RE.search(line)
        if cap and not DIST_RE.search(line[: cap.start()]):
            # "No faster than 10:25/mi" qualifies the step above it
            if last is not None and last_was_easy:
                cap_pace = _pace_to_profile(int(cap.group(1)), int(cap.group(2)), cap.group(3), p)
                last.pace_s = max(last.pace_s or 0, cap_pace)
                if last.distance_m:
                    last.duration_s = round(last.distance_m / METERS_PER[p.unit] * last.pace_s)
            continue

        rest_seg = None
        rest = REST_RE.search(line)
        if rest:
            rest_seg = Segment(
                label=f"{rest.group(1)}{rest.group(2)[0]} walking rest",
                kind="rest",
                group=group,
                duration_s=_secs(float(rest.group(1)), rest.group(2)),
            )
            line = (line[: rest.start()] + line[rest.end() :]).strip(" ,;+-")

        seg = None
        pace = PACE_RE.search(line)
        dist = DIST_RE.search(PACE_RE.sub("", line))
        time = TIME_RE.search(PACE_RE.sub("", line)) if not dist else None
        easy = bool(EASY_RE.search(line)) or not pace

        if dist or time:
            pace_s = (
                _pace_to_profile(int(pace.group(1)), int(pace.group(2)), pace.group(3), p)
                if pace
                else p.easy_pace_s
            )
            if dist:
                meters = float(dist.group(1)) * METERS_PER[_unit_key(dist.group(2))]
                duration = meters / METERS_PER[p.unit] * pace_s
                label = f"{dist.group(1)}{_unit_key(dist.group(2))}"
            else:
                duration = _secs(float(time.group(1)), time.group(2))
                meters = duration / pace_s * METERS_PER[p.unit]
                label = f"{time.group(1)}{time.group(2)}"
            label += " easy" if easy else f" @ {pace.group(1)}:{pace.group(2)}/{_unit_key(pace.group(3))}"
            seg = Segment(
                label=label,
                group=group,
                duration_s=round(duration),
                distance_m=round(meters, 1),
                pace_s=round(pace_s, 1),
            )
            steps.append(seg)
            last, last_was_easy = seg, easy
        if rest_seg:
            steps.append(rest_seg)
            if seg is None:
                last = None

    flush()
    out: list[Segment] = []
    for grp, rep, block_steps in blocks:
        for i in range(rep):
            for s in block_steps:
                c = s.model_copy()
                if rep > 1:
                    c.label = f"{s.label} ({i + 1}/{rep})"
                out.append(c)
    return finalize(out, p)


# --------------------------------------------------------------- Strava laps
def segments_from_laps(laps: list[dict], p: RunnerProfile, use_strava_cadence: bool = True) -> list[Segment]:
    """Turn a completed Strava activity's laps into segments. Uses the run's
    recorded cadence when the watch logged it (Strava stores cadence per foot,
    so steps per minute is double)."""
    segs: list[Segment] = []
    n = len(laps)
    for i, lap in enumerate(laps):
        dist = float(lap.get("distance") or 0)
        secs = float(lap.get("moving_time") or lap.get("elapsed_time") or 0)
        if secs <= 0:
            continue
        pace_s = secs / dist * METERS_PER[p.unit] if dist > 20 else None
        walking = pace_s is None or pace_s > 15 * 60 * METERS_PER[p.unit] / METERS_PER["mi"]
        group = "Warm-Up" if i == 0 and n > 2 else "Cool Down" if i == n - 1 and n > 2 else "Session"
        seg = Segment(
            label=lap.get("name") or f"Lap {i + 1}",
            kind="rest" if walking else "run",
            group=group,
            duration_s=round(secs),
            distance_m=round(dist, 1),
            pace_s=round(pace_s, 1) if pace_s else None,
        )
        cad = lap.get("average_cadence")
        if use_strava_cadence and cad:
            spm = cad * 2 if cad < 120 else cad
            seg.cadence, seg.cadence_source = round(spm, 1), "strava"
        segs.append(seg)
    return finalize(segs, p)
