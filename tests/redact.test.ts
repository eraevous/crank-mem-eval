import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { redact, stripBlocks } from "../src/daemon/redact.ts";
import { REPO_ROOT } from "./helpers.ts";

describe("stripBlocks", () => {
  test.each([
    ["a <private>x</private> b", "a  b"],
    ["a <system-reminder>\nline\n</system-reminder>b", "a b"],
    ["keep <private>open to the end\nmore", "keep "],
    ["keep <system-reminder>open", "keep "],
    ["<private>all of it</private>", ""],
    ["no tags", "no tags"],
    ["", ""],
    ["<private>a</private> mid <private>b</private>", " mid "],
  ])("%j", (input, expected) => {
    expect(stripBlocks(input)).toBe(expected);
  });
});

// Samples are built by concatenation so no literal real-shaped token sits in this public repo.
const VENDOR_SAMPLES: [string, string][] = [
  ["AWS access key", "AKIA" + "IOSFODNN7EXAMPL" + "E"],
  ["AWS temporary key", "ASIA" + "IOSFODNN7EXAMPL" + "E"],
  ...["ghp_", "gho_", "ghu_", "ghs_", "ghr_"].map((p): [string, string] => [
    `GitHub ${p}`,
    p + "a1".repeat(18),
  ]),
  ["GitHub fine-grained", "github_" + "pat_" + "11A".repeat(10)],
  ["Anthropic", "sk-" + "ant-api03-" + "a1".repeat(20)],
  ["OpenAI project", "sk-" + "proj-" + "a1".repeat(20)],
  ["OpenAI legacy", "sk-" + "a1".repeat(20)],
  ...["b", "a", "p", "r", "s"].map((k): [string, string] => [
    `Slack xox${k}-`,
    "xox" + k + "-" + "1234567890-" + "abcdefghijkl",
  ]),
  ["Slack webhook", "https://hooks.slack.com/" + "services/T0000/B0000/" + "a1".repeat(12)],
  ["JWT", "eyJ" + "hbGciOiJIUzI1NiJ9" + ".eyJ" + "zdWIiOiIxIn0" + "." + "a1".repeat(10)],
  ["Stripe secret", "sk_" + "live_" + "a1".repeat(12)],
  ["Stripe restricted", "rk_" + "test_" + "a1".repeat(12)],
  ["Google API key", "AIza" + "a1".repeat(17) + "b"],
  ["GitLab", "glpat-" + "a1".repeat(10)],
  ["Hugging Face", "hf_" + "a1".repeat(17)],
  ["npm", "npm_" + "a1".repeat(18)],
  ["Docker", "dckr_" + "pat_" + "a1".repeat(14)],
  ["SendGrid", "SG." + "a1".repeat(11) + "." + "b2".repeat(21) + "c"],
  ...["dop_", "doo_", "dor_"].map((p): [string, string] => [
    `DigitalOcean ${p}`,
    p + "v1_" + "a1".repeat(32),
  ]),
  ...["shpat_", "shpss_", "shpca_", "shppa_"].map((p): [string, string] => [
    `Shopify ${p}`,
    p + "a1".repeat(16),
  ]),
  ["PyPI", "pypi-" + "AgEIcHlwaS5vcmc" + "a1".repeat(20)],
  [
    "Discord webhook",
    "https://discord.com/api/" + "webhooks/123456789012345678/" + "a1".repeat(30),
  ],
];

describe("redact vendor tokens", () => {
  test.each(VENDOR_SAMPLES)("%s", (_vendor, sample) => {
    expect(redact(`x ${sample} y`)).toBe("x [redacted] y");
  });
});

const KEYED_ROWS: [string, string][] = [
  ["password=hunter2hunter2", "password=[redacted]"],
  ['{"api_key": "abc123def"}', '{"api_key": "[redacted]"}'],
  ['{\\"password\\": \\"hunter2\\"}', '{\\"password\\": \\"[redacted]\\"}'],
  [
    "aws_secret_access_key = " + "wJalrXUtnFEMI" + "K7MDENGbPxRfiCY" + "EXAMPLEKEY",
    "aws_secret_access_key = [redacted]",
  ],
  ["AWS_SESSION_TOKEN=" + "FwoGZXIvYXdz" + "a1".repeat(20), "AWS_SESSION_TOKEN=[redacted]"],
  ["TOKEN: abc", "TOKEN: [redacted]"],
  ["postgres://app:hunter2@db.example.com/x", "postgres://app:[redacted]@db.example.com/x"],
  ["Authorization: Bearer abc.def.ghi", "Authorization: Bearer [redacted]"],
  ["authorization: basic dXNlcjpwYXNz", "authorization: basic [redacted]"],
  [
    "-----BEGIN RSA " + "PRIVATE KEY-----\nMIIabc\n-----END RSA " + "PRIVATE KEY-----",
    "[redacted]",
  ],
  ["-----BEGIN " + "PRIVATE KEY-----\nMIIabc\n-----END " + "PRIVATE KEY-----", "[redacted]"],
  ["a -----BEGIN " + "PRIVATE KEY-----\nMIIabc\nMIIdef", "a [redacted]"],
  ["password=", "password="],
  ['{"api_key": ""}', '{"api_key": ""}'],
  ["DB_PASSWORD=hunter2", "DB_PASSWORD=[redacted]"],
  ["OPENAI_API_KEY=abc123xyz", "OPENAI_API_KEY=[redacted]"],
  ["GITHUB_TOKEN=ghx123abc", "GITHUB_TOKEN=[redacted]"],
  ["SECRET_KEY=django-xyz", "SECRET_KEY=[redacted]"],
  ["client_secret: s3cr3t", "client_secret: [redacted]"],
  ["x-api-key: abc123", "x-api-key: [redacted]"],
  ["MY_APP_SECRET=v4lue", "MY_APP_SECRET=[redacted]"],
  ["SLACK_BOT_TOKEN=v4lue", "SLACK_BOT_TOKEN=[redacted]"],
  // Added in our line (see ATTRIBUTION.md): command-line flags and repeated separators.
  ["mysql --password=hunter2", "mysql --password=[redacted]"],
  ["curl --api-key=abc123", "curl --api-key=[redacted]"],
  ["gh --token=abc123", "gh --token=[redacted]"],
  ["tool -token=abc123", "tool -token=[redacted]"],
  ["cli --db-password=hunter2", "cli --db-password=[redacted]"],
  ["foo--password=hunter2", "foo--password=[redacted]"],
  ["APP__SECRET=abc", "APP__SECRET=[redacted]"],
  ['{"stripe-api-key": "abc"}', '{"stripe-api-key": "[redacted]"}'],
  ["DJANGO_SECRET_KEY=abc", "DJANGO_SECRET_KEY=[redacted]"],
  ["svn+ssh://me:pw1@host/repo", "svn+ssh://me:[redacted]@host/repo"],
  ["see-https://me:pw1@host", "see-https://me:[redacted]@host"],
  // v0.16 masks credentials after a scheme of any length; a 33-character one still masks here.
  ["z".repeat(33) + "://me:pw1@host", "z".repeat(33) + "://me:[redacted]@host"],
  ["1.5x-https://me:pw1@host", "1.5x-https://me:[redacted]@host"],
];

describe("redact keyed values", () => {
  test.each(KEYED_ROWS)("%j", (input, expected) => {
    expect(redact(input)).toBe(expected);
  });
});

describe("redact leaves near-misses alone", () => {
  test.each([
    "max_tokens: 4096",
    "token_count = 5",
    "sk-short",
    "the password is wrong",
    "eyJhbGci",
    "https://example.com/a:b@c",
    "AKIA",
    "secretary: Bob",
    "ghp_short",
    "xtoken=abc",
    "password_hint: blue",
    "refresh_token_ttl=30",
    "input_tokens=12",
    "token-limit: 5",
    "MAX_TOKENS=4096",
    "PASSWORD_MIN_LENGTH=12",
    "SECRET_ROTATION_DAYS: 30",
    "",
  ])("%j", (input) => {
    expect(redact(input)).toBe(input);
  });

  test.each([
    ...VENDOR_SAMPLES.map(([, sample]) => `x ${sample} y`),
    ...KEYED_ROWS.map(([input]) => input),
  ])("is idempotent on %j", (input) => {
    const once = redact(input);
    expect(redact(once)).toBe(once);
  });
});

// Added in our line (see ATTRIBUTION.md): a name-start anchor keeps the keyed-value scan linear.
// v0.16's pattern retried the prefix loop at every `-` in a long hyphenated run (about 1.8 s
// for 80,000 characters under bun); the bound below is far above linear time and far below that.
describe("redact stays linear on long hyphenated runs", () => {
  test.each([["a-".repeat(40_000)], ["a-".repeat(40_000) + "=x"], ["x--".repeat(26_000)]])(
    "%#",
    (input) => {
      const started = performance.now();
      expect(redact(input)).toBe(input);
      expect(performance.now() - started).toBeLessThan(300);
    },
  );

  // CRK-REQ-005 asks for growing inputs, each pattern on its own: keyed values (`=x`) and URL
  // credentials (`://u:p@h`). v0.16 took about 4.8 s at 80,000 repeats for the URL form alone, so
  // a quadratic scan at 160,000 would run for many seconds; a linear one stays far under 300 ms.
  test.each([
    ["keyed", "=x", "=x"],
    ["url", "://u:p@h", "://u:[redacted]@h"],
  ])("%s pattern at growing sizes", (_name, tail, masked) => {
    for (const n of [10_000, 40_000, 160_000]) {
      const run = "a-".repeat(n);
      const started = performance.now();
      expect(redact(run + tail)).toBe(run + masked);
      expect(performance.now() - started).toBeLessThan(300);
    }
  });
});

describe("redaction has no switch", () => {
  test("redact takes one argument and ignores any extra one", () => {
    expect(redact.length).toBe(1);
    expect(Reflect.apply(redact, undefined, ["password=hunter2hunter2", false])).toBe(
      "password=[redacted]",
    );
  });

  test("src/daemon/redact.ts imports nothing and reads no environment", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, "src/daemon/redact.ts"), "utf-8");
    expect(source).not.toMatch(/^\s*(?:import|export)\b[^;]*?\bfrom\s*["']/m);
    expect(source).not.toMatch(/^\s*import\s*["']/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
    expect(source).not.toMatch(/\bprocess\.env\b/);
  });
});
