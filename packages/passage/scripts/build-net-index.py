#!/usr/bin/env python3
"""Download the NET Bible into a Passage-compatible NET.index.json.

API documentation and copyright terms: https://labs.bible.org/api_web_service
"""

from __future__ import annotations

import argparse
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import re
import socket
import tempfile
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

API_URL = "https://labs.bible.org/api/"
USER_AGENT = "logseq-passage-net-index/1.0"

# API name, Passage short name, display name, number of chapters.
BOOKS = (
    ("Genesis", "Gen", "Genesis", 50), ("Exodus", "Ex", "Exodus", 40),
    ("Leviticus", "Lev", "Leviticus", 27), ("Numbers", "Num", "Numbers", 36),
    ("Deuteronomy", "Deut", "Deuteronomy", 34), ("Joshua", "Josh", "Joshua", 24),
    ("Judges", "Judg", "Judges", 21), ("Ruth", "Ruth", "Ruth", 4),
    ("1 Samuel", "1Sam", "1 Samuel", 31), ("2 Samuel", "2Sam", "2 Samuel", 24),
    ("1 Kings", "1Kings", "1 Kings", 22), ("2 Kings", "2Kings", "2 Kings", 25),
    ("1 Chronicles", "1Chron", "1 Chronicles", 29),
    ("2 Chronicles", "2Chron", "2 Chronicles", 36), ("Ezra", "Ezra", "Ezra", 10),
    ("Nehemiah", "Neh", "Nehemiah", 13), ("Esther", "Est", "Esther", 10),
    ("Job", "Job", "Job", 42), ("Psalms", "Ps", "Psalms", 150),
    ("Proverbs", "Prov", "Proverbs", 31), ("Ecclesiastes", "Eccles", "Ecclesiastes", 12),
    ("Song of Songs", "Song", "Song of Solomon", 8), ("Isaiah", "Isa", "Isaiah", 66),
    ("Jeremiah", "Jer", "Jeremiah", 52), ("Lamentations", "Lam", "Lamentations", 5),
    ("Ezekiel", "Ezek", "Ezekiel", 48), ("Daniel", "Dan", "Daniel", 12),
    ("Hosea", "Hos", "Hosea", 14), ("Joel", "Joel", "Joel", 3),
    ("Amos", "Amos", "Amos", 9), ("Obadiah", "Obad", "Obadiah", 1),
    ("Jonah", "Jonah", "Jonah", 4), ("Micah", "Mic", "Micah", 7),
    ("Nahum", "Nah", "Nahum", 3), ("Habakkuk", "Hab", "Habakkuk", 3),
    ("Zephaniah", "Zeph", "Zephaniah", 3), ("Haggai", "Hag", "Haggai", 2),
    ("Zechariah", "Zech", "Zechariah", 14), ("Malachi", "Mal", "Malachi", 4),
    ("Matthew", "Matt", "Matthew", 28), ("Mark", "Mark", "Mark", 16),
    ("Luke", "Luke", "Luke", 24), ("John", "John", "John", 21),
    ("Acts", "Acts", "Acts", 28), ("Romans", "Rom", "Romans", 16),
    ("1 Corinthians", "1Cor", "1 Corinthians", 16),
    ("2 Corinthians", "2Cor", "2 Corinthians", 13), ("Galatians", "Gal", "Galatians", 6),
    ("Ephesians", "Eph", "Ephesians", 6), ("Philippians", "Phil", "Philippians", 4),
    ("Colossians", "Col", "Colossians", 4),
    ("1 Thessalonians", "1Thess", "1 Thessalonians", 5),
    ("2 Thessalonians", "2Thess", "2 Thessalonians", 3),
    ("1 Timothy", "1Tim", "1 Timothy", 6), ("2 Timothy", "2Tim", "2 Timothy", 4),
    ("Titus", "Titus", "Titus", 3), ("Philemon", "Philem", "Philemon", 1),
    ("Hebrews", "Heb", "Hebrews", 13), ("James", "James", "James", 5),
    ("1 Peter", "1Pet", "1 Peter", 5), ("2 Peter", "2Pet", "2 Peter", 3),
    ("1 John", "1John", "1 John", 5), ("2 John", "2John", "2 John", 1),
    ("3 John", "3John", "3 John", 1), ("Jude", "Jude", "Jude", 1),
    ("Revelation", "Rev", "Revelation", 22),
)


class MarkupParser(HTMLParser):
    """Remove the API's `para` markup while retaining poetry lineation."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.starts_paragraph = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "p":
            return
        css_class = dict(attrs).get("class", "") or ""
        if not self.parts:
            self.starts_paragraph = True
        elif "poetry" in css_class and self.parts[-1] != "\n":
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def result(self) -> str:
        return "\n".join(
            re.sub(r"\s+", " ", line).strip()
            for line in "".join(self.parts).splitlines()
        ).strip()


def parse_markup(markup: str) -> tuple[str, bool]:
    parser = MarkupParser()
    parser.feed(markup)
    parser.close()
    return parser.result(), parser.starts_paragraph


def fetch_chapter(passage: str, timeout: float, retries: int) -> list[dict[str, Any]]:
    query = urlencode({"passage": passage, "type": "json", "formatting": "para"})
    request = Request(f"{API_URL}?{query}", headers={"User-Agent": USER_AGENT})
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                result = json.load(response)
            if not isinstance(result, list) or not result:
                raise ValueError("API returned no verses")
            return result
        except (HTTPError, URLError, TimeoutError, socket.timeout, json.JSONDecodeError) as error:
            if attempt == retries:
                raise RuntimeError(f"could not download {passage}: {error}") from error
            time.sleep(2**attempt)
    raise AssertionError("unreachable")


Fetcher = Callable[[str, float, int], list[dict[str, Any]]]


def build_index(fetcher: Fetcher = fetch_chapter, *, timeout: float, retries: int,
                delay: float) -> dict[str, Any]:
    books: list[dict[str, Any]] = []
    indexes: dict[str, dict[str, Any]] = {
        "versesByRef": {}, "refsByVerseId": {}, "chaptersByRef": {}, "booksByShortName": {}
    }
    verse_id, paragraph_id, chapter_total = 1, 1, 0

    for book_id, (api_name, short_name, long_name, chapter_count) in enumerate(BOOKS, 1):
        book_start, chapters, chapter_refs = verse_id, [], []
        for chapter_number in range(1, chapter_count + 1):
            if delay and verse_id > 1:
                time.sleep(delay)
            rows = fetcher(f"{api_name} {chapter_number}", timeout, retries)
            verses, paragraphs, current, seen = [], [], None, set()
            for row in rows:
                number, returned_chapter = int(row["verse"]), int(row["chapter"])
                if returned_chapter != chapter_number or number in seen:
                    raise ValueError(f"unexpected verse in {api_name} {chapter_number}: {row!r}")
                seen.add(number)
                text, starts_paragraph = parse_markup(str(row["text"]))
                if current is None or starts_paragraph:
                    current = {"paragraphId": paragraph_id, "fromVerseId": verse_id,
                               "toVerseId": verse_id, "verses": []}
                    paragraph_id += 1
                    paragraphs.append(current)
                reference = f"{short_name}/{chapter_number}/{number}"
                verse = {"verseId": verse_id, "ref": reference, "shortName": short_name,
                         "longName": long_name, "bookId": book_id, "chapter": chapter_number,
                         "verseNum": number, "paragraphId": current["paragraphId"], "text": text}
                verses.append(verse)
                current["verses"].append(verse)
                current["toVerseId"] = verse_id
                indexes["versesByRef"][reference] = verse_id
                indexes["refsByVerseId"][str(verse_id)] = reference
                verse_id += 1

            chapter_ref = f"{short_name}/{chapter_number}"
            chapter = {"chapter": chapter_number, "chapterRef": chapter_ref,
                       "fromVerseId": verses[0]["verseId"], "toVerseId": verses[-1]["verseId"],
                       "paragraphs": paragraphs, "verses": verses}
            chapters.append(chapter)
            chapter_refs.append(chapter_ref)
            indexes["chaptersByRef"][chapter_ref] = {
                "bookId": book_id, "shortName": short_name, "longName": long_name,
                "chapter": chapter_number, "fromVerseId": chapter["fromVerseId"],
                "toVerseId": chapter["toVerseId"],
                "paragraphIds": [item["paragraphId"] for item in paragraphs],
                "verseIds": [item["verseId"] for item in verses]}
            chapter_total += 1

        books.append({"bookId": book_id, "shortName": short_name, "longName": long_name,
                      "fromVerseId": book_start, "toVerseId": verse_id - 1, "chapters": chapters})
        indexes["booksByShortName"][short_name] = {
            "bookId": book_id, "shortName": short_name, "longName": long_name,
            "fromVerseId": book_start, "toVerseId": verse_id - 1, "chapters": chapter_refs}

    return {"schemaVersion": 1, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "stats": {"books": len(books), "chapters": chapter_total,
                      "paragraphs": paragraph_id - 1, "verses": verse_id - 1},
            "books": books, "indexes": indexes}


def write_atomically(destination: Path, data: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(
        dir=destination.parent, prefix=f".{destination.name}.", suffix=".tmp")
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump(data, output, ensure_ascii=False, separators=(",", ":"))
            output.write("\n")
        os.replace(temporary, destination)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).parents[1] / "resources/NET.index.json")
    parser.add_argument("--timeout", type=float, default=30)
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--delay", type=float, default=0.1)
    args = parser.parse_args()
    if args.timeout <= 0 or args.retries < 0 or args.delay < 0:
        parser.error("timeout must be positive; retries and delay must be nonnegative")
    index = build_index(timeout=args.timeout, retries=args.retries, delay=args.delay)
    write_atomically(args.output.resolve(), index)
    stats = index["stats"]
    print(f"Wrote {args.output}: {stats['books']} books, {stats['chapters']} chapters, "
          f"{stats['paragraphs']} paragraphs, {stats['verses']} verses")


if __name__ == "__main__":
    main()
