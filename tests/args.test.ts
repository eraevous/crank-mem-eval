import { describe, expect, test } from "bun:test";
import { parseArgs, positive, stringFlag, unknownFlag } from "../src/cli/args.ts";

// src/cli/args.ts is the flag parser every command and the daemon share.
// main.ts rejects unknown flags through unknownFlag before a command loads,
// and the commands read their values through positive and stringFlag, so
// these pin the contract their doc comments state. The parser is pure, so
// these tests import it directly rather than running the CLI.

describe("parseArgs", () => {
  test("a value flag takes the next argument; a boolean flag stands alone; the rest stay in order", () => {
    const { flags, rest } = parseArgs(["fix", "--limit", "5", "lock", "--stale", "bug"], ["limit"]);
    expect(flags).toEqual({ limit: "5", stale: true });
    expect(rest).toEqual(["fix", "lock", "bug"]);
  });

  test("a value flag in last place, with no argument after it, reads as true", () => {
    expect(parseArgs(["query", "--since"], ["since"]).flags).toEqual({ since: true });
  });

  test("a flag not in the value list never consumes the argument after it", () => {
    const { flags, rest } = parseArgs(["--stale", "5"], ["limit"]);
    expect(flags).toEqual({ stale: true });
    expect(rest).toEqual(["5"]);
  });

  test("a repeated flag keeps its last value", () => {
    expect(parseArgs(["--limit", "3", "--limit", "7"], ["limit"]).flags).toEqual({ limit: "7" });
  });

  test("--key=value is not split: the whole text after -- is the flag name", () => {
    expect(parseArgs(["--limit=5"], ["limit"]).flags).toEqual({ "limit=5": true });
  });

  test("a single dash is an ordinary argument, not a flag", () => {
    const { flags, rest } = parseArgs(["-", "-n"], []);
    expect(flags).toEqual({});
    expect(rest).toEqual(["-", "-n"]);
  });

  test("an empty argv gives no flags and no rest", () => {
    expect(parseArgs([], ["limit"])).toEqual({ flags: {}, rest: [] });
  });
});

describe("unknownFlag", () => {
  test("null when every flag is a known value or boolean flag", () => {
    expect(unknownFlag(["q", "--limit", "5", "--stale"], ["limit"], ["stale"])).toBeNull();
  });

  test("names the first flag that is in neither list", () => {
    expect(unknownFlag(["--stale", "--bogus", "--worse"], [], ["stale"])).toBe("bogus");
  });

  test("a value flag's argument is never read as a flag name", () => {
    // `x` is consumed as --type's value, so it is not checked.
    expect(unknownFlag(["--type", "x"], ["type"], [])).toBeNull();
  });

  test("--key=value is reported whole, so the mistyped form fails instead of passing", () => {
    expect(unknownFlag(["--limit=5"], ["limit"], [])).toBe("limit=5");
  });
});

describe("positive", () => {
  test("a positive number string is the value", () => {
    expect(positive("250", 1000)).toBe(250);
    expect(positive("0.5", 1000)).toBe(0.5);
  });

  test("absent, valueless, zero, negative, non-numeric and infinite all fall back", () => {
    for (const value of [undefined, true, false, "0", "-3", "abc", "Infinity", "NaN"]) {
      expect(positive(value, 1000)).toBe(1000);
    }
  });

  test("an empty string falls back rather than reading as 0", () => {
    expect(positive("", 1000)).toBe(1000);
  });
});

describe("stringFlag", () => {
  test("undefined when absent, the string when given, null when the flag came without a value", () => {
    expect(stringFlag(undefined)).toBeUndefined();
    expect(stringFlag("2026-11-01")).toBe("2026-11-01");
    expect(stringFlag(true)).toBeNull();
  });

  test("an empty string value is still a string, not null", () => {
    expect(stringFlag("")).toBe("");
  });
});
