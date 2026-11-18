const BLOCK = /<(private|system-reminder)>[\s\S]*?(?:<\/\1>|$)/g;
const MASK = "[redacted]";

/** Removes `<private>` and `<system-reminder>` blocks; an unclosed tag strips to the end. */
export function stripBlocks(text: string): string {
  return text.replace(BLOCK, "");
}

// Vendor token shapes, replaced whole.
const VENDOR_TOKENS: RegExp[] = [
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g, // OpenAI legacy and project keys, and Anthropic sk-ant-
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_/-]+/g,
  /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{10,}/g,
  /\bAIza[A-Za-z0-9_-]{35}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bhf_[A-Za-z0-9]{34,}/g,
  /\bnpm_[A-Za-z0-9]{36,}/g,
  /\bdckr_pat_[A-Za-z0-9_-]{20,}/g,
  /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}/g,
  /\bdo[opr]_v1_[a-f0-9]{64}/g,
  /\bshp(?:at|ss|ca|pa)_[a-fA-F0-9]{32}/g,
  /\bpypi-AgEIcHlwaS5vcmc[A-Za-z0-9_-]{20,}/g,
  /https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g,
];

// A PEM private key block, replaced whole; a BEGIN with no END runs to the end of the text.
const PEM =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g;

// Each keeps group 1 (the key and its punctuation) and masks group 2 (the value).
// A value runs to the next whitespace, quote, backslash, comma or semicolon.
// Added in our line (see ATTRIBUTION.md): the first pattern starts only where a name starts,
// not at every `-` inside one (`(?=[a-z0-9])` plus a lookbehind that refuses a start after a
// name character and any hyphens), so a long hyphenated run is scanned once rather than once
// per hyphen. Leading hyphens still start a name, as a command-line flag does (`--password=`),
// and prefix separators may repeat (`APP__SECRET`, `foo--password`).
const KEYED_VALUES: RegExp[] = [
  /(?=[a-z0-9])(?<![a-z0-9_]-*)((?:[a-z0-9]+[_-]+)*(?:password|passwd|pwd|secret|api_key|apikey|api-key|access_token|auth_token|token|aws_secret_access_key|aws_session_token)(?:[_-]key)?\b\\?["']?\s*[:=]\s*\\?["']?)([^\s"'\\,;]+)/gi,
  // A URL scheme is at most 32 characters here (real ones are short), so a start inside a long
  // run of scheme characters gives up after 32 rather than scanning to the run's end. Added in
  // our line, with the anchor above.
  /\b([a-z][a-z0-9+.-]{0,31}:\/\/[^\s:/@]+:)([^\s@/]+)(?=@)/gi,
  /\b(authorization\s*:\s*(?:(?:bearer|basic|token|digest)\s+)?)([^\s"'\\,;]+)/gi,
];

/** Replaces secrets in `text` with `[redacted]`. Always on: there is no switch. */
export function redact(text: string): string {
  let out = text.replace(PEM, MASK);
  for (const re of VENDOR_TOKENS) out = out.replace(re, MASK);
  for (const re of KEYED_VALUES) out = out.replace(re, `$1${MASK}`);
  return out;
}
