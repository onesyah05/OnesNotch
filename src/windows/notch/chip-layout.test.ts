import { describe, expect, it } from "vitest";
import {
  chipLayout,
  chipRadius,
  isCompactAnswer,
  splitPgAnswer,
  unwrapAnswerText,
  PANEL_RADIUS,
  PILL_RADIUS,
} from "./chip-layout";

describe("isCompactAnswer", () => {
  it("treats MCQ one-liners as compact", () => {
    expect(isCompactAnswer("3. C | 4. D | 5. C")).toBe(true);
    expect(isCompactAnswer("C")).toBe(true);
    expect(isCompactAnswer("")).toBe(true);
  });

  it("treats essays, lists, and code as expanded", () => {
    expect(isCompactAnswer("Pancasila adalah dasar negara.\n\nSila pertama...")).toBe(false);
    expect(isCompactAnswer("- poin satu\n- poin dua")).toBe(false);
    expect(isCompactAnswer("```ts\nconst x = 1;\n```")).toBe(false);
    expect(isCompactAnswer("a".repeat(141))).toBe(false);
  });
});

describe("chipLayout", () => {
  it("uses the explicit kind when available", () => {
    expect(chipLayout("pg", "short answer")).toBe("pg");
    expect(chipLayout("essay", "3. C")).toBe("essay");
  });

  it("falls back to compact detection when kind is null", () => {
    expect(chipLayout(null, "3. C | 4. D")).toBe("pg");
    expect(chipLayout(null, "Long essay\n\nwith paragraphs")).toBe("essay");
  });
});

describe("splitPgAnswer", () => {
  it("splits pipe-separated answers and extracts numbers", () => {
    expect(splitPgAnswer("3. C | 4. D | 5. A")).toEqual([
      { label: "3", choice: "C" },
      { label: "4", choice: "D" },
      { label: "5", choice: "A" },
    ]);
    expect(splitPgAnswer("B")).toEqual([{ label: null, choice: "B" }]);
  });

  it("handles raw JSON dictionary maps as resilient fallback", () => {
    expect(splitPgAnswer('{"6":"c","7":"c","8":"c"}')).toEqual([
      { label: "6", choice: "C" },
      { label: "7", choice: "C" },
      { label: "8", choice: "C" },
    ]);
  });
});

describe("unwrapAnswerText", () => {
  it("unwraps single-question JSON maps without quotes or brackets", () => {
    const raw = JSON.stringify({
      "1": "Pengertian ranah kognitif, afektif, psikomotor, dan life skill:\n- Kognitif: ...",
    });
    expect(unwrapAnswerText(raw)).toBe(
      "Pengertian ranah kognitif, afektif, psikomotor, dan life skill:\n- Kognitif: ...",
    );
  });

  it("unwraps answer wrappers like { answer: ... }", () => {
    expect(unwrapAnswerText('{"type":"essay","answer":"Penjelasan rinci"}')).toBe(
      "Penjelasan rinci",
    );
  });

  it("leaves standard text untouched", () => {
    expect(unwrapAnswerText("Plain text answer")).toBe("Plain text answer");
  });
});

describe("chipRadius", () => {
  it("stays a pill for short chips and a panel for tall ones", () => {
    expect(chipRadius(44)).toBe(PILL_RADIUS);
    expect(chipRadius(64)).toBe(PILL_RADIUS);
    expect(chipRadius(80)).toBe(PANEL_RADIUS);
  });
});
