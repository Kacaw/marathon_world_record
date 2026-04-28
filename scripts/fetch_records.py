#!/usr/bin/env python3
"""Fetch marathon world record progression tables into a local JSON dataset."""

from __future__ import annotations

import json
import re
import sys
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime
from html.parser import HTMLParser
from pathlib import Path


WIKIPEDIA_URL = "https://en.wikipedia.org/wiki/Marathon_world_record_progression"
WORLD_ATHLETICS_SAWE_URL = (
    "https://worldathletics.org/news/report/"
    "sawe-two-hour-assefa-world-record-london-marathon"
)
WORLD_ATHLETICS_CHEPNGETICH_RATIFIED_URL = (
    "https://worldathletics.org/news/press-releases/"
    "ratified-world-records-chebet-duplantis-mclaughlin-levrone-chepngetich-kawano"
)
WORLD_ATHLETICS_KIPTUM_RATIFIED_URL = (
    "https://worldathletics.org/news/press-releases/"
    "ratified-world-marathon-record-kelvin-kiptum"
)


@dataclass
class Record:
    category: str
    race_type: str
    time: str
    athlete: str
    nationality: str
    date: str
    event: str
    source: str
    notes: str
    seconds: float
    decimal_year: float
    status: str


class WikiTableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._in_table = False
        self._table_depth = 0
        self._current_table: list[list[str]] = []
        self._current_row: list[str] | None = None
        self._current_cell: list[str] | None = None
        self._in_cell = False
        self._skip = False
        self._skip_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attrs_dict = {key: value or "" for key, value in attrs}
        if (
            tag == "table"
            and not self._in_table
            and "wikitable" in attrs_dict.get("class", "")
        ):
            self._in_table = True
            self._table_depth = 1
            self._current_table = []
            return

        if not self._in_table:
            return

        if tag == "table":
            self._table_depth += 1
        elif tag == "tr":
            self._current_row = []
        elif tag in {"td", "th"} and self._current_row is not None:
            self._current_cell = []
            self._in_cell = True
        elif tag in {"script", "style", "sup"} and self._in_cell:
            self._skip = True
            self._skip_depth = 1
        elif self._skip:
            self._skip_depth += 1

    def handle_endtag(self, tag: str) -> None:
        if not self._in_table:
            return

        if self._skip:
            self._skip_depth -= 1
            if self._skip_depth <= 0:
                self._skip = False
            return

        if tag in {"td", "th"} and self._in_cell and self._current_cell is not None:
            text = " ".join("".join(self._current_cell).split())
            self._current_row.append(text)  # type: ignore[union-attr]
            self._current_cell = None
            self._in_cell = False
        elif tag == "tr" and self._current_row is not None:
            if self._current_row:
                self._current_table.append(self._current_row)
            self._current_row = None
        elif tag == "table":
            self._table_depth -= 1
            if self._table_depth == 0:
                self.tables.append(self._current_table)
                self._in_table = False

    def handle_data(self, data: str) -> None:
        if self._in_cell and not self._skip and self._current_cell is not None:
            self._current_cell.append(data)


def fetch(url: str) -> str:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 Codex marathon-world-record dataset"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8")


def parse_time(raw_time: str) -> tuple[str, str, float]:
    race_type = "Standard"
    cleaned = raw_time.strip()
    if cleaned.endswith(" Mx"):
        race_type = "Mixed"
        cleaned = cleaned[:-3].strip()
    elif cleaned.endswith(" Wo"):
        race_type = "Women only"
        cleaned = cleaned[:-3].strip()

    parts = cleaned.split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    elif len(parts) == 3:
        hours, minutes, seconds = parts
    else:
        raise ValueError(f"Unsupported time format: {raw_time}")

    return cleaned, race_type, int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def decimal_year(date_text: str) -> float:
    parsed = datetime.strptime(date_text, "%B %d, %Y").date()
    start = date(parsed.year, 1, 1)
    end = date(parsed.year + 1, 1, 1)
    return parsed.year + (parsed - start).days / (end - start).days


def status_from(source: str, notes: str) -> str:
    note_text = notes.lower()
    if "pending ratification" in note_text:
        return "Pending ratification"
    if "disputed" in note_text or "short course" in note_text or "time trial" in note_text:
        return "Listed / disputed"
    if "world athletics" in source.lower() or "iaaf" in source.lower():
        return "World Athletics progression"
    if "arrs" in source.lower():
        return "ARRS progression"
    return "Listed"


def parse_records(html: str) -> list[Record]:
    parser = WikiTableParser()
    parser.feed(html)
    if len(parser.tables) < 2:
        raise RuntimeError("Expected at least two wikitable tables in source page.")

    records: list[Record] = []
    for category, table in zip(["Men", "Women"], parser.tables[:2]):
        for row in table[1:]:
            if len(row) < 7 or not re.match(r"^\d", row[0]):
                continue
            display_time, race_type, seconds = parse_time(row[0])
            if category == "Men":
                race_type = "Men"
            record = Record(
                category=category,
                race_type=race_type,
                time=display_time,
                athlete=row[1],
                nationality=row[2],
                date=row[3],
                event=row[4],
                source=row[5],
                notes=row[6],
                seconds=seconds,
                decimal_year=round(decimal_year(row[3]), 6),
                status=status_from(row[5], row[6]),
            )
            records.append(record)
    return records


def main() -> int:
    out_path = Path("data/records.json")
    js_out_path = Path("data/records-data.js")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    records = parse_records(fetch(WIKIPEDIA_URL))
    payload = {
        "generated_at": date.today().isoformat(),
        "sources": [
            {
                "name": "Wikipedia: Marathon world record progression",
                "url": WIKIPEDIA_URL,
                "usage": "Historical progression tables for men and women.",
            },
            {
                "name": "World Athletics: Sawe 1:59:30 / Assefa 2:15:41 London report",
                "url": WORLD_ATHLETICS_SAWE_URL,
                "usage": "Latest 2026 marks and pending-ratification note.",
            },
            {
                "name": "World Athletics: Chepngetich 2:09:56 ratification",
                "url": WORLD_ATHLETICS_CHEPNGETICH_RATIFIED_URL,
                "usage": "Women mixed marathon record ratification.",
            },
            {
                "name": "World Athletics: Kiptum 2:00:35 ratification",
                "url": WORLD_ATHLETICS_KIPTUM_RATIFIED_URL,
                "usage": "Men marathon record ratification before 2026 pending mark.",
            },
        ],
        "records": [record.__dict__ for record in records],
    }
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    js_out_path.write_text(
        "window.MARATHON_RECORDS = "
        + json.dumps(payload, ensure_ascii=False, indent=2)
        + ";\n"
    )
    print(f"Wrote {len(records)} records to {out_path} and {js_out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
