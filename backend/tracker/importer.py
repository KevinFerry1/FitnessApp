import re
from dataclasses import asdict, dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation


DATE_HEADER = re.compile(
    r"^(?P<date>\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s*(?P<name>.*)$",
    re.IGNORECASE,
)
SET_PATTERN = re.compile(r"(?P<count>\d+)\s*[x×]\s*(?P<reps>\d+(?:\s*,\s*\d+)*)", re.IGNORECASE)
WEIGHT_TOKEN = re.compile(
    r"(?<![\d,])(?P<weights>\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*)\s*(?P<unit>lbs?|kg|plates?|plate)?\b",
    re.IGNORECASE,
)
LEADING_WEIGHT_UNIT = re.compile(r"^\s*(?:lbs?|kg|plates?)\b", re.IGNORECASE)


@dataclass
class ParsedSet:
    set_number: int
    reps: int | None
    weight: Decimal | None
    weight_unit: str

    def to_dict(self):
        value = asdict(self)
        value["weight"] = str(self.weight) if self.weight is not None else None
        return value


@dataclass
class ParsedExercise:
    name: str
    sets: list[ParsedSet] = field(default_factory=list)
    notes: str = ""
    original_line: str = ""

    def to_dict(self):
        return {"name": self.name, "sets": [item.to_dict() for item in self.sets], "notes": self.notes, "original_line": self.original_line}


@dataclass
class ParsedWorkout:
    workout_date: date
    name: str
    exercises: list[ParsedExercise] = field(default_factory=list)

    def to_dict(self):
        return {"date": self.workout_date.isoformat(), "name": self.name, "exercises": [item.to_dict() for item in self.exercises]}


def _parse_date(raw: str, default_year: int) -> date:
    parts = re.split(r"[/-]", raw)
    month, day = int(parts[0]), int(parts[1])
    year = int(parts[2]) if len(parts) > 2 else default_year
    if year < 100:
        year += 2000
    return date(year, month, day)


def _decimal_list(raw: str) -> list[Decimal]:
    result = []
    for token in raw.split(","):
        try:
            result.append(Decimal(token.strip()))
        except InvalidOperation:
            pass
    return result


def _normalize_unit(raw: str | None, weights: list[Decimal]) -> str:
    if not raw:
        # The existing Notes shorthand uses values such as 2.25 for plate-loaded
        # machines. Keep that convention without treating ordinary integers as plates.
        if weights and all(value <= 5 and value % 1 in {Decimal("0.25"), Decimal("0.5"), Decimal("0.75")} for value in weights):
            return "plate"
        return "lb"
    value = raw.lower()
    if value.startswith("kg"):
        return "kg"
    if value.startswith("plate"):
        return "plate"
    return "lb"


def parse_exercise_line(line: str) -> ParsedExercise | None:
    original = line.strip()
    set_match = SET_PATTERN.search(original)
    if not set_match:
        return None

    name = original[: set_match.start()].strip(" ,-:")
    if not name:
        return None

    count = int(set_match.group("count"))
    reps_text = set_match.group("reps")
    tail = original[set_match.end() :]
    # In Notes, a comma can separate a single rep count from the weight:
    # "2x7, 25lb" means two sets of 7 at 25 lb, not reps of 7 and 25.
    # The unit immediately after the final number disambiguates this case.
    if "," in reps_text and LEADING_WEIGHT_UNIT.match(tail):
        reps_text, final_weight = reps_text.rsplit(",", 1)
        tail = final_weight.strip() + tail
    reps = [int(value.strip()) for value in reps_text.split(",")]
    tail = tail.strip(" ,-:")

    # Parentheses are kept as notes (e.g. machine seat settings: "(4,1)").
    parenthetical = " ".join(value.strip() for value in re.findall(r"\(([^)]*)\)", tail) if value.strip())
    searchable_tail = re.sub(r"\([^)]*\)", "", tail).strip()
    weight_match = WEIGHT_TOKEN.match(searchable_tail)
    weights: list[Decimal] = []
    unit = "lb"
    consumed = 0
    if weight_match:
        weights = _decimal_list(weight_match.group("weights"))
        unit = _normalize_unit(weight_match.group("unit"), weights)
        consumed = weight_match.end()

    trailing_note = searchable_tail[consumed:].strip(" ,-:") if consumed else searchable_tail
    notes = "; ".join(part for part in (trailing_note, parenthetical) if part)

    if len(reps) == 1:
        reps *= count
    if weights and len(weights) == 1:
        weights *= count

    sets = []
    for index in range(count):
        sets.append(
            ParsedSet(
                set_number=index + 1,
                reps=reps[index] if index < len(reps) else reps[-1],
                weight=weights[index] if index < len(weights) else (weights[-1] if weights else None),
                weight_unit=unit,
            )
        )
    return ParsedExercise(name=name, sets=sets, notes=notes, original_line=original)


def parse_notes(text: str, default_year: int | None = None) -> tuple[list[ParsedWorkout], list[dict]]:
    default_year = default_year or datetime.now().year
    workouts: list[ParsedWorkout] = []
    warnings: list[dict] = []
    current: ParsedWorkout | None = None

    for line_number, raw_line in enumerate(text.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.lower() in {"workout progress", "workouts"}:
            continue

        header = DATE_HEADER.match(line)
        if header:
            try:
                current = ParsedWorkout(
                    workout_date=_parse_date(header.group("date"), default_year),
                    name=header.group("name").strip(" -") or "Workout",
                )
                workouts.append(current)
            except ValueError:
                warnings.append({"line": line_number, "text": line, "message": "Invalid workout date"})
            continue

        exercise = parse_exercise_line(line)
        if exercise:
            if current is None:
                current = ParsedWorkout(workout_date=date.today(), name="Imported workout")
                workouts.append(current)
                warnings.append({"line": line_number, "text": line, "message": "No date header; used today's date"})
            current.exercises.append(exercise)
        else:
            warnings.append({"line": line_number, "text": line, "message": "Could not recognize an exercise with sets (for example 2x8,7)"})

    return workouts, warnings
