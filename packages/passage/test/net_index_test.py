import importlib.util
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / "scripts" / "build-net-index.py"
SPEC = importlib.util.spec_from_file_location("build_net_index", SCRIPT)
net = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(net)


class NetIndexTest(unittest.TestCase):
    def test_markup_becomes_text_and_keeps_poetry_lines(self):
        text, starts = net.parse_markup(
            '<p class="bodytext">A &amp; B. <b>Heading</b><p class="poetry">Next line.</p>')
        self.assertEqual(text, "A & B. Heading\nNext line.")
        self.assertTrue(starts)

    def test_small_fixture_has_the_source_index_shape(self):
        original_books = net.BOOKS
        net.BOOKS = (("Song of Songs", "Song", "Song of Solomon", 1),)
        rows = [
            {"chapter": "1", "verse": "1", "text": '<p class="bodytext">First.'},
            {"chapter": "1", "verse": "2", "text": "Second."},
            {"chapter": "1", "verse": "3", "text": '<p class="bodytext">Third.'},
        ]
        try:
            index = net.build_index(lambda passage, timeout, retries: rows,
                                    timeout=1, retries=0, delay=0)
        finally:
            net.BOOKS = original_books
        self.assertEqual(index["stats"],
                         {"books": 1, "chapters": 1, "paragraphs": 2, "verses": 3})
        self.assertEqual(index["schemaVersion"], 2)
        # The index names the translation it holds, so build-bible-index.mjs
        # needs no arguments to say what it is converting.
        self.assertEqual(index["translation"],
                         {"name": "New English Translation", "abbreviation": "NET"})
        self.assertNotIn("indexes", index)
        self.assertNotIn("generatedAt", index)
        self.assertEqual(index["books"][0]["longName"], "Song of Solomon")
        chapter = index["books"][0]["chapters"][0]
        self.assertEqual(chapter["chapterNum"], 1)
        self.assertEqual([item["paragraphNum"] for item in chapter["paragraphs"]], [1, 2])
        self.assertEqual(
            [verse["verseId"] for item in chapter["paragraphs"] for verse in item["verses"]],
            [1, 2, 3])
        self.assertEqual(chapter["paragraphs"][0]["verses"][1],
                         {"verseId": 2, "verseNum": 2, "text": "Second."})

    def test_atomic_writer_creates_valid_json(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "NET.index.json"
            net.write_atomically(destination, {"schemaVersion": 1})
            self.assertEqual(destination.read_text(encoding="utf-8"),
                             '{"schemaVersion":1}\n')


if __name__ == "__main__":
    unittest.main()
