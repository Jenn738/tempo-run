from app.workout import RunnerProfile, parse_workout_text, segments_from_laps

RUNNA = """Warm-Up
1
0.5mi at a conversational pace
No faster than 10:25/mi
RUN
Session (2 - 4)
2
0.5mi at 9:45/mi
RUN
3
1mi at 9:05/mi
RUN
4
1mi at 8:55/mi
90s walking rest
Cool Down
5
0.5mi at a conversational pace
"""


def test_parses_runna_progression_run():
    p = RunnerProfile()  # easy 10:30/mi
    segs = parse_workout_text(RUNNA, p)
    assert [s.kind for s in segs] == ["run", "run", "run", "run", "rest", "run"]
    assert [s.group for s in segs] == ["Warm-Up", "Session", "Session", "Session", "Session", "Cool Down"]
    assert [round(s.duration_s) for s in segs] == [315, 292, 545, 535, 90, 315]
    # faster steps get a higher cadence
    cad = [s.cadence for s in segs]
    assert cad[0] < cad[1] < cad[2] < cad[3]
    assert cad[4] == p.walk_cadence


def test_cap_raises_easy_pace_when_runner_is_quick():
    p = RunnerProfile(easy_pace_s=600)  # 10:00/mi easy, but step says no faster than 10:25
    segs = parse_workout_text("0.5mi easy\nNo faster than 10:25/mi", p)
    assert segs[0].pace_s == 625


def test_same_line_run_and_rest_and_repeats():
    segs = parse_workout_text("Session x3\n400m at 5:00/km 90s rest", RunnerProfile(unit="km"))
    assert [s.kind for s in segs] == ["run", "rest"] * 3
    assert segs[0].duration_s == 120


def test_time_based_steps():
    segs = parse_workout_text("10 min easy\n5 min at 8:30/mi", RunnerProfile())
    assert [s.duration_s for s in segs] == [600, 300]


def test_strava_laps_use_recorded_cadence():
    laps = [
        {"distance": 1609, "moving_time": 630, "average_cadence": 81},
        {"distance": 1609, "moving_time": 545, "average_cadence": 85},
        {"distance": 30, "moving_time": 90},
        {"distance": 1609, "moving_time": 640},
    ]
    segs = segments_from_laps(laps, RunnerProfile())
    assert segs[0].cadence == 162 and segs[0].cadence_source == "strava"
    assert segs[2].kind == "rest"
    assert segs[3].cadence_source == "pace"
