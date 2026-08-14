import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  it("joins columns and rows with commas and CRLF", () => {
    const csv = toCsv(["Name", "Amount"], [["ABC", 5000], ["XYZ", 2000]]);
    expect(csv).toBe("Name,Amount\r\nABC,5000\r\nXYZ,2000");
  });

  it("quotes and escapes cells containing commas, quotes, or newlines", () => {
    const csv = toCsv(["Notes"], [['Contains, a comma'], ['Has "quotes"'], ["Multi\nline"]]);
    expect(csv).toBe('Notes\r\n"Contains, a comma"\r\n"Has ""quotes"""\r\n"Multi\nline"');
  });

  it("renders null/undefined as empty cells", () => {
    const csv = toCsv(["A", "B"], [[null, undefined]]);
    expect(csv).toBe("A,B\r\n,");
  });
});
