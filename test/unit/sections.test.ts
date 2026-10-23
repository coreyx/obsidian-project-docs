import { describe, expect, it } from "vitest";
import {
  decodeSection,
  publicOnlyLines,
  remainingPlaceholders,
} from "../../src/decode/sections.js";

const mapping = new Map([
  ["myhost", "DESK-FAKE01"],
  ["100.64.0.1", "100.99.12.34"],
  ["100.64.0.10", "100.99.12.40"],
]);

describe("decodeSection", () => {
  const note = [
    "# Servers", // 0
    "", // 1
    "ssh myhost, then 100.64.0.10", // 2
    "", // 3
    "<!-- public-only -->", // 4
    "Read PRIVATE.md for myhost.", // 5
    "", // 6
    "Still public-only.", // 7
    "<!-- /public-only -->", // 8
    "", // 9
    "notmyhost stays", // 10
  ].join("\n");

  it("restores a section's own lines with the standard's rules", () => {
    expect(decodeSection(note, 2, 2, mapping)).toBe("ssh DESK-FAKE01, then 100.99.12.40");
    expect(decodeSection(note, 10, 10, mapping)).toBe("notmyhost stays");
  });

  it("drops lines inside a public-only block, even one spanning sections", () => {
    expect(decodeSection(note, 5, 5, mapping)).toBe("");
    expect(decodeSection(note, 7, 8, mapping)).toBe("");
    expect(decodeSection(note, 2, 5, mapping)).toBe("ssh DESK-FAKE01, then 100.99.12.40\n");
  });

  it("finds public-only lines in CRLF text and at the end of a note", () => {
    expect([
      ...publicOnlyLines("a\r\n<!-- public-only -->\r\nx\r\n<!-- /public-only -->\r\nb"),
    ]).toEqual([1, 2, 3]);
    expect([...publicOnlyLines("<!-- public-only -->\nx\n<!-- /public-only -->")]).toEqual([
      0, 1, 2,
    ]);
    expect(publicOnlyLines("<!-- public-only -->\nnever closed\n").size).toBe(0);
  });
});

describe("remainingPlaceholders", () => {
  it("names placeholders still on screen, with the boundary rule", () => {
    expect(remainingPlaceholders("ssh myhost at 100.64.0.1", mapping)).toEqual([
      "myhost",
      "100.64.0.1",
    ]);
    expect(remainingPlaceholders("notmyhost and 100.64.0.10", mapping)).toEqual(["100.64.0.10"]);
    expect(remainingPlaceholders("DESK-FAKE01", mapping)).toEqual([]);
  });
});
