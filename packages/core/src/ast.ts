import type { Range } from "./position";

// --- Documents -----------------------------------------------------------

/** A document is either pure JSON5 data or an `override` block. */
export type Document = DataDocument | OverrideDocument;

export interface DataDocument {
  kind: "data-document";
  value: ValueNode;
  range: Range;
}

export interface OverrideDocument {
  kind: "override-document";
  /** The `extends "<specifier>"` clause, if present. */
  specifier?: StringNode;
  /** Top-level object operations applied to the base. */
  ops: ObjectOp[];
  range: Range;
}

// --- JSON5 values --------------------------------------------------------

export type ValueNode = ObjectNode | ArrayNode | StringNode | NumberNode | BooleanNode | NullNode;

export interface ObjectNode {
  kind: "object";
  members: ObjectMember[];
  range: Range;
}

export interface ObjectMember {
  kind: "member";
  key: KeyNode;
  value: ValueNode;
  range: Range;
}

export interface ArrayNode {
  kind: "array";
  elements: ValueNode[];
  range: Range;
}

export interface StringNode {
  kind: "string";
  value: string;
  range: Range;
}

export interface NumberNode {
  kind: "number";
  value: number;
  raw: string;
  range: Range;
}

export interface BooleanNode {
  kind: "boolean";
  value: boolean;
  range: Range;
}

export interface NullNode {
  kind: "null";
  range: Range;
}

export interface KeyNode {
  kind: "key";
  name: string;
  quoted: boolean;
  range: Range;
}

// --- Operation positioning ----------------------------------------------

export interface RelativePosition {
  kind: "relative-position";
  placement: "before" | "after";
  key: KeyNode;
  range: Range;
}

// --- Object operations ---------------------------------------------------

export type ObjectOp =
  | SetOp
  | AddOp
  | OverrideMoveOp
  | OverrideMergeOp
  | DeleteOp
  | ClearOp
  | InheritOp;

/** `prop: v` — create or replace, positioned here. */
export interface SetOp {
  kind: "set";
  key: KeyNode;
  value: ValueNode;
  range: Range;
}

/** `add prop [before|after X]: v` — semantic create/replace with optional relative position. */
export interface AddOp {
  kind: "add";
  key: KeyNode;
  position?: RelativePosition;
  value: ValueNode;
  range: Range;
}

/** `override prop [before|after X]` — reposition without touching the value. */
export interface OverrideMoveOp {
  kind: "override-move";
  key: KeyNode;
  position?: RelativePosition;
  range: Range;
}

/** `override prop [before|after X]: v` — merge the value, positioned here. */
export interface OverrideMergeOp {
  kind: "override-merge";
  key: KeyNode;
  position?: RelativePosition;
  value: MergeValue;
  range: Range;
}

/** `delete prop` — remove the property. */
export interface DeleteOp {
  kind: "delete";
  key: KeyNode;
  range: Range;
}

/** `clear` — empty the collection (only valid at the start of a block). */
export interface ClearOp {
  kind: "clear";
  range: Range;
}

/** `inherit` — placeholder for the remaining non-mentioned inherited keys. */
export interface InheritOp {
  kind: "inherit";
  range: Range;
}

/** The value of an `override prop: ...` operation. */
export type MergeValue = ObjectOpsValue | ArrayOpsValue | ValueNode;

export interface ObjectOpsValue {
  kind: "object-ops";
  ops: ObjectOp[];
  range: Range;
}

export interface ArrayOpsValue {
  kind: "array-ops";
  ops: ArrayOp[];
  range: Range;
}

// --- Array operations ----------------------------------------------------

export type ArrayOp = ArrayAddOp | ArrayDeleteOp | ArrayClearOp;

/** `add [/(n)/] v` or a bare `v` — append, or insert at index n. */
export interface ArrayAddOp {
  kind: "array-add";
  index?: number;
  value: ValueNode;
  range: Range;
}

/** `delete(n)` — remove the element at index n. */
export interface ArrayDeleteOp {
  kind: "array-delete";
  index: number;
  range: Range;
}

/** `clear` — empty the array (only valid at the start of a block). */
export interface ArrayClearOp {
  kind: "array-clear";
  range: Range;
}
