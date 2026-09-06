# Passage v1 content contract

A passage block is Logseq content, not a runtime. The Passage plugin writes it;
a theme — Dark High Contrast among them — reads it back and styles it. Neither
package loads, imports, calls, or requires the other: what they share is the
shape written down here, and each side is tested against the same fixtures
independently.

This contract is versioned. `v1` is what `logseq-passage` 0.1.0 writes and what
`logseq-dark-high-contrast-theme` 2.0.0 reads.

## Block source

A passage occupies one block. Its source is a property drawer, then a
`#+BEGIN_PASSAGE` custom block:

```text
tags:: John/3
type:: Passage
#+BEGIN_PASSAGE
**John 3:16-17**

First verse of the fixture. Second verse of the fixture.
#+END_PASSAGE
```

- `#+BEGIN_PASSAGE` and `#+END_PASSAGE` each stand on a line of their own.
  `PASSAGE` is not one of the admonition names compiled into mldoc, so Logseq
  renders the block through its generic custom-block path as a bare
  `div.passage` — that element is the only render hook the contract offers.
- The first line inside the marker is the canonical reference in bold, and
  nothing else. A theme may treat it as the passage's title.
- One blank line follows the reference. The passage text begins under it, and
  paragraphs within the passage are separated by a blank line. A passage with no
  text leaves that line empty; the block is still a valid passage.

## Properties

Two properties, written into the block's own drawer at the very top of the
content — never beside the marker, where Logseq would not read them.

| Key | Value |
| --- | --- |
| `type` | `Passage`, in that casing |
| `tags` | one `ShortBook/Chapter` tag per chapter the passage spans, comma-separated; empty when the reference did not resolve |

A key the block already declares is left exactly as the author wrote it. A
reader of the contract matches `type` **case-insensitively**: `type:: Passage`
is what is written, `type: passage` is what a theme's property rules configure,
and both name the same block. This is why the theme ships `type: passage` as its
default rule and folds both halves of every pair before comparing.

## Verse numbers

A verse number is written as Unicode superscript digits (U+2070, U+00B9–U+00B3,
U+2074–U+2079) wrapped in Logseq's highlight markup, immediately before the
verse it numbers and with no space between:

```text
^^¹⁶^^First verse of the fixture.
```

Superscript digits rather than `<sup>`, and highlight markup rather than a raw
run of digits, because the markup is what gives the number a `mark` element a
theme can select. A `mark` is not proof of a verse number: a reader's own
highlight is one too, so a reader of the contract that cares about the
distinction matches the whole `^^…^^` run against superscript digits alone.

Whether every number opens a line is a property of the block, not of a number:
inside `#+BEGIN_PASSAGE` mldoc parses the whole body as one paragraph of inline
nodes separated by line breaks, so CSS cannot tell a number that opens a line
from one that merely follows a break inside the verse before it. A reader that
wants to know reads the block's source and answers once for the whole block —
which is what `data-hc-verse-lines` records.

## Attribute ownership

Both packages write into the same host document, and each owns a prefix.

| Owner | Writes | Never touches |
| --- | --- | --- |
| `logseq-passage` | `data-passage-*` attributes, the `passage-dialog` style key, element ids beginning `passage-` | anything else |
| `logseq-dark-high-contrast-theme` | `data-hc-*` attributes, the `hc-hidden-properties` style key | anything else |

Neither package reads the other's attributes, and neither may clear one. Style
keys are namespaced for the same reason: `provideStyle` replaces a style by key,
so a shared key would let either package silently unstyle the other.

## Cleanup

Everything either package writes lives in the host document, which outlives the
plugin, so unloading must leave none of it behind — and only its own. On
`beforeunload` each package disconnects its observer, removes the nodes it
injected, clears the attributes it wrote, and settles any prompt still open as a
cancellation, writing nothing. A passage already written to the graph is
content, not decoration: it survives either package being uninstalled.

## Compatibility rules

- **The theme works with no Passage installed.** It styles whatever passage
  blocks a graph holds, whoever wrote them — by hand, by an older version, or by
  another tool.
- **Passage works with no theme installed.** What it writes is ordinary Logseq
  markup that renders readably unstyled; its one piece of chrome, the reference
  dialog, carries a fallback for every colour it names.
- **A passage written before the split still reads.** Blocks written by the
  theme's own Passage command up to 1.10.1 are v1 blocks; nothing about the
  shape changed when the command moved packages.
- **Settings do not move by themselves.** `hiddenProperties` stays a theme
  setting and `biblePassageText` becomes a Passage setting; a reader who had
  configured a text-index path re-enters it under Passage once.
- A future `v2` would be a new document. A reader that cannot parse a block
  leaves it alone rather than guessing.

## Fixtures

Normative. Both packages' tests read the block below: Passage asserts these are
the block sources its command writes, and the theme asserts these are the block
sources its classification reads. The verse text is fixture data.

<!-- passage-v1-fixtures:start -->
```json
{
  "index": {
    "books": {
      "John": {
        "3": {
          "verses": ["First verse of the fixture.", "Second verse of the fixture."],
          "numbers": [16, 17],
          "paragraphs": [16]
        }
      }
    }
  },
  "cases": [
    {
      "name": "prose",
      "reference": "jn 3:16-17",
      "display": {},
      "text": true,
      "verseLines": false,
      "source": "tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\nFirst verse of the fixture. Second verse of the fixture.\n#+END_PASSAGE"
    },
    {
      "name": "numbered prose",
      "reference": "jn 3:16-17",
      "display": { "numbers": true },
      "text": true,
      "verseLines": false,
      "source": "tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\n^^¹⁶^^First verse of the fixture. ^^¹⁷^^Second verse of the fixture.\n#+END_PASSAGE"
    },
    {
      "name": "one verse per line",
      "reference": "jn 3:16-17",
      "display": { "numbers": true, "perLine": true },
      "text": true,
      "verseLines": true,
      "source": "tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\n^^¹⁶^^First verse of the fixture.\n^^¹⁷^^Second verse of the fixture.\n#+END_PASSAGE"
    },
    {
      "name": "chapter heading",
      "reference": "jn 3:16-17",
      "display": { "headings": true, "numbers": true, "perLine": true },
      "text": true,
      "verseLines": true,
      "source": "tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\n**John 3**\n\n^^¹⁶^^First verse of the fixture.\n^^¹⁷^^Second verse of the fixture.\n#+END_PASSAGE"
    },
    {
      "name": "no text index",
      "reference": "jn 3:16-17",
      "display": {},
      "text": false,
      "verseLines": false,
      "source": "tags:: John/3\ntype:: Passage\n#+BEGIN_PASSAGE\n**John 3:16-17**\n\n#+END_PASSAGE"
    }
  ]
}
```
<!-- passage-v1-fixtures:end -->

Each case also holds, for the reading side:

- `verseLines` — whether every verse number in the block opens a line, and so
  whether a reader should hang the numbers in a gutter.
- `text` — whether a text index was available. Absent, the reference and its
  tags are still written and the body is left to the reader.

Every fixture block is a special block source: a reader that hides bullets, or
otherwise treats structural blocks differently, classifies all five the same
way.
