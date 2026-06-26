/** A single point in a source document. */
export interface Position {
  /** Zero-based character offset from the start of the source. */
  offset: number;
  /** One-based line number. */
  line: number;
  /** One-based column number. */
  column: number;
}

/** A span between two positions in a source document. */
export interface Range {
  start: Position;
  end: Position;
}

export function rangeBetween(start: Range, end: Range): Range {
  return { start: start.start, end: end.end };
}
