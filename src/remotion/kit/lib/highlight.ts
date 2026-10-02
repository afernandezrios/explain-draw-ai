/**
 * Just enough syntax colouring to make a code scene read.
 *
 * This is a display highlighter, not a parser, and it is honest about that: it
 * scans one line at a time with no state carried between lines, so a block
 * comment or a template literal that spans lines colours correctly on its first
 * line and plainly after. That limit is deliberate -- a real grammar would be a
 * dependency, a bundle and a failure mode, in service of scenes whose code is
 * written by the same author as the narration.
 *
 * The vocabulary is what an explainer actually shows: keywords, strings,
 * numbers, comments, calls, properties.
 */

export const LANGUAGES = ['ts', 'js', 'json', 'sql', 'bash', 'python', 'text'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LANGUAGE_LABEL: Record<Language, string> = {
  ts: 'typescript',
  js: 'javascript',
  json: 'json',
  sql: 'sql',
  bash: 'bash',
  python: 'python',
  text: 'text',
};

export type TokenKind =
  | 'plain'
  | 'keyword'
  | 'string'
  | 'number'
  | 'comment'
  | 'fn'
  | 'property'
  | 'punct';

export type Token = { kind: TokenKind; text: string };

const KEYWORDS: Record<Language, readonly string[]> = {
  ts: [
    'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function',
    'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let', 'new', 'of', 'return',
    'satisfies', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var',
    'void', 'while', 'yield', 'true', 'false', 'null', 'undefined',
  ],
  js: [
    'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'delete',
    'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'import', 'in',
    'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw',
    'try', 'typeof', 'var', 'void', 'while', 'yield', 'true', 'false', 'null', 'undefined',
  ],
  json: ['true', 'false', 'null'],
  sql: [
    'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'full', 'cross', 'on',
    'group', 'by', 'order', 'having', 'limit', 'offset', 'insert', 'into', 'values', 'update',
    'set', 'delete', 'create', 'table', 'index', 'primary', 'key', 'foreign', 'references',
    'not', 'null', 'default', 'and', 'or', 'as', 'distinct', 'count', 'sum', 'avg', 'min', 'max',
    'with', 'union', 'all', 'case', 'when', 'then', 'else', 'end', 'returning',
  ],
  bash: [
    'if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'case', 'esac',
    'function', 'return', 'export', 'local', 'echo', 'cd', 'cat', 'grep', 'curl', 'npm', 'node',
    'git', 'docker', 'kubectl', 'sudo', 'rm', 'mkdir', 'export',
  ],
  python: [
    'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
    'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
    'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield', 'None',
    'True', 'False', 'self',
  ],
  text: [],
};

/** SQL is written in either case and both are the same keyword. */
const CASE_INSENSITIVE = new Set<Language>(['sql']);

function keywordsFor(language: Language): Set<string> {
  const words = KEYWORDS[language];
  return new Set(
    CASE_INSENSITIVE.has(language) ? words.map((word) => word.toLowerCase()) : words,
  );
}

const KEYWORD_SETS = new Map<Language, Set<string>>(
  LANGUAGES.map((language) => [language, keywordsFor(language)]),
);

function commentStart(line: string, at: number, language: Language): number | null {
  const two = line.slice(at, at + 2);
  if (language === 'ts' || language === 'js') {
    if (two === '//' || two === '/*') {
      return two === '/*' ? blockCommentEnd(line, at) : line.length;
    }
  }
  if ((language === 'sql' && two === '--') || (language === 'sql' && two === '/*')) {
    return two === '/*' ? blockCommentEnd(line, at) : line.length;
  }
  if ((language === 'python' || language === 'bash') && line[at] === '#') {
    return line.length;
  }
  return null;
}

function blockCommentEnd(line: string, at: number): number {
  const close = line.indexOf('*/', at + 2);
  return close === -1 ? line.length : close + 2;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[\w$]/;

/** The next character that is not a space, or '' at the end of the line. */
function nextNonSpace(line: string, at: number): string {
  for (let i = at; i < line.length; i++) {
    if (line[i] !== ' ') {
      return line[i];
    }
  }
  return '';
}

/** True when a string token should colour as a key rather than as a value. */
function isObjectKey(line: string, end: number): boolean {
  return nextNonSpace(line, end) === ':';
}

export function tokenizeLine(line: string, language: Language): Token[] {
  const keywords = KEYWORD_SETS.get(language) ?? new Set<string>();
  const tokens: Token[] = [];
  let i = 0;

  const push = (kind: TokenKind, text: string): void => {
    if (text.length > 0) {
      tokens.push({ kind, text });
    }
  };

  while (i < line.length) {
    const char = line[i];

    const commentEnd = commentStart(line, i, language);
    if (commentEnd !== null) {
      push('comment', line.slice(i, commentEnd));
      i = commentEnd;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      const close = line.indexOf(char, i + 1);
      const end = close === -1 ? line.length : close + 1;
      const text = line.slice(i, end);
      push(language === 'json' && isObjectKey(line, end) ? 'property' : 'string', text);
      i = end;
      continue;
    }

    if (char >= '0' && char <= '9') {
      let end = i;
      while (end < line.length && /[\w.]/.test(line[end])) {
        end++;
      }
      push('number', line.slice(i, end));
      i = end;
      continue;
    }

    if (IDENT_START.test(char)) {
      let end = i;
      while (end < line.length && IDENT_PART.test(line[end])) {
        end++;
      }
      const word = line.slice(i, end);
      const lookup = CASE_INSENSITIVE.has(language) ? word.toLowerCase() : word;
      const previous = tokens[tokens.length - 1];
      const afterDot = previous !== undefined && previous.kind === 'punct' && previous.text === '.';
      let kind: TokenKind = 'plain';
      if (keywords.has(lookup)) {
        kind = 'keyword';
      } else if (afterDot) {
        kind = 'property';
      } else if (nextNonSpace(line, end) === '(') {
        kind = 'fn';
      }
      push(kind, word);
      i = end;
      continue;
    }

    push('punct', char);
    i++;
  }

  return tokens;
}

/** The whole listing, line by line -- the shape `CodeBlock` renders. */
export function tokenize(code: string, language: Language): Token[][] {
  return code.split('\n').map((line) => tokenizeLine(line, language));
}
