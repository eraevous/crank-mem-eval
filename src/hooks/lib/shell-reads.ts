// The files a Bash command reads with a plain read tool or `crank-mem outline`/`unfold`. A best-effort
// lexer, not a shell parser: callers filter the candidates through
// memoryPaths, so a stray word such as a `head -n` count costs nothing.

const READERS = new Set(["cat", "sed", "head", "tail", "awk", "nl"]);
/** Readers whose first non-flag word is a program, not a file. */
const PROGRAM_FIRST = new Set(["sed", "awk"]);
/** `crank-mem` subcommands whose first non-flag word, outside a `--from` value, is the file they read. */
const CODE_READERS = new Set(["outline", "unfold"]);
const REDIRECTS = new Set([">", ">>", "2>", "&>"]);

/**
 * A heredoc operator and its delimiter word. `<<<` is a here-string, which has no body, so the
 * lookarounds keep it out. Group 1 is `-` for `<<-`, group 3 the delimiter.
 */
const HEREDOC = /(?<!<)<<(-?)(?!<)\s*(['"]?)([\w.-]+)\2/g;

/** The command with each heredoc body, terminator line included, removed. */
function dropHeredocs(command: string): string {
  const kept: string[] = [];
  const pending: { word: string; tabs: boolean }[] = [];
  for (const line of command.split("\n")) {
    if (pending.length > 0) {
      // Bash strips leading tabs from every `<<-` body line, the terminator included.
      const end = pending[0]!;
      if ((end.tabs ? line.replace(/^\t+/, "") : line) === end.word) pending.shift();
      continue;
    }
    kept.push(line);
    for (const m of line.matchAll(HEREDOC)) pending.push({ word: m[3]!, tabs: m[1] === "-" });
  }
  return kept.join("\n");
}

/** Words and segments `segments` has lexed so far. */
interface Lexer {
  out: string[][];
  words: string[];
  word: string;
  quote: string | null;
}

function endWord(lx: Lexer): void {
  if (lx.word) lx.words.push(lx.word);
  lx.word = "";
}

function endSegment(lx: Lexer): void {
  endWord(lx);
  if (lx.words.length > 0) lx.out.push(lx.words);
  lx.words = [];
}

/** Lexes the character at `i` into `lx` and returns the index of the next unread character. */
function lexChar(lx: Lexer, command: string, i: number): number {
  const c = command[i]!;
  if (lx.quote) {
    if (c === lx.quote) lx.quote = null;
    else lx.word += c;
  } else if (c === "'" || c === '"') {
    lx.quote = c;
  } else if ((c === "|" || c === "&") && command[i + 1] === c) {
    endSegment(lx);
    return i + 2;
  } else if (c === ";" || c === "\n" || c === "|") {
    endSegment(lx);
  } else if (/\s/.test(c)) {
    endWord(lx);
  } else {
    lx.word += c;
  }
  return i + 1;
}

/** Segments split on `&&`, `||`, `;`, `|` and newlines outside quotes, each as unquoted words. */
function segments(command: string): string[][] {
  const lx: Lexer = { out: [], words: [], word: "", quote: null };
  for (let i = 0; i < command.length;) i = lexChar(lx, command, i);
  endSegment(lx);
  return lx.out;
}

/** The file a `crank-mem outline`/`unfold` reads: its first non-flag word outside a `--from` value. */
function codeReaderPath(args: string[]): string | undefined {
  return args.find((w, i, words) => !w.startsWith("-") && words[i - 1] !== "--from");
}

/** A reader's words with flags, redirects and each redirect's target removed. */
function readerArgs(rest: string[]): string[] {
  const args: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i]!;
    if (REDIRECTS.has(w) || w === "<<" || w === "<<-") i++;
    else if (w.startsWith(">") || w === "<" || w.startsWith("<<") || w.startsWith("-")) continue;
    else args.push(w);
  }
  return args;
}

/** Candidate paths the read commands in `command` name, in order. */
export function shellReadPaths(command: string): string[] {
  const paths: string[] = [];
  for (const [name, ...rest] of segments(dropHeredocs(command))) {
    if (name === "crank-mem" && CODE_READERS.has(rest[0]!)) {
      const file = codeReaderPath(rest.slice(1));
      if (file !== undefined) paths.push(file);
    } else if (READERS.has(name!)) {
      const args = readerArgs(rest);
      paths.push(...(PROGRAM_FIRST.has(name!) ? args.slice(1) : args));
    }
  }
  return paths;
}
