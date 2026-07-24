import type { UndoOp } from "@shared/protocol";
import { computed, shallowRef, type ShallowRef } from "vue";

import { request } from "./use-db";
import { showToast } from "./use-toast";

interface Entry {
  op: UndoOp;
  label: string;
}

const MAX_DEPTH = 100;

const undoStack = shallowRef<Entry[]>([]);
const redoStack = shallowRef<Entry[]>([]);

const canUndo = computed(() => undoStack.value.length > 0);
const canRedo = computed(() => redoStack.value.length > 0);

function recordEdit(op: UndoOp | undefined, label: string): void {
  if (!op) return;
  undoStack.value = [...undoStack.value, { op, label }].slice(-MAX_DEPTH);
  redoStack.value = [];
}

// Entries address rows by rowid. Once another process has written to the file
// those rowids may point at different rows — or nothing — so replaying an entry
// could corrupt data rather than restore it. Dropping the history is the only
// safe response.
function discardHistory(): void {
  undoStack.value = [];
  redoStack.value = [];
}

async function step(
  from: ShallowRef<Entry[]>,
  to: ShallowRef<Entry[]>,
  verb: string,
): Promise<UndoOp | null> {
  const entry = from.value.at(-1);
  if (!entry) return null;

  const res = await request("mutationResult", (reqId) => ({
    type: "applyUndo" as const,
    reqId,
    op: entry.op,
  }));

  if (!res.ok) {
    showToast(res.error ?? `Could not ${verb.toLowerCase()}.`, true);
    return null;
  }

  from.value = from.value.slice(0, -1);
  if (res.undo) to.value = [...to.value, { op: res.undo, label: entry.label }];
  showToast(
    res.undoUnavailable
      ? `${verb} ${entry.label}. ${res.undoUnavailable}`
      : `${verb} ${entry.label}.`,
  );
  return entry.op;
}

export function useUndo() {
  return {
    canUndo,
    canRedo,
    recordEdit,
    discardHistory,
    undoStep: () => step(undoStack, redoStack, "Undid"),
    redoStep: () => step(redoStack, undoStack, "Redid"),
  };
}
