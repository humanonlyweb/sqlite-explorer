import type { DatabaseSchema, InboundMessage, OutboundMessage } from "@shared/protocol";
import { shallowRef } from "vue";

import { showToast } from "./use-toast";

interface VsCodeApi {
  postMessage(msg: InboundMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();

type ResponseHandler = (msg: OutboundMessage) => boolean;

let reqSeq = 0;
const pending = new Map<number, ResponseHandler>();

export const schema = shallowRef<DatabaseSchema | null>(null);
export const externalChangeCount = shallowRef(0);

function isResponse<K extends OutboundMessage["type"]>(
  msg: OutboundMessage,
  type: K,
): msg is Extract<OutboundMessage, { type: K }> {
  return msg.type === type;
}

export function request<K extends OutboundMessage["type"]>(
  expected: K,
  build: (reqId: number) => InboundMessage,
): Promise<Extract<OutboundMessage, { type: K }>> {
  const reqId = ++reqSeq;
  return new Promise((resolve) => {
    pending.set(reqId, (msg) => {
      if (!isResponse(msg, expected)) return false;
      resolve(msg);
      return true;
    });
    vscode.postMessage(build(reqId));
  });
}

export function post(msg: InboundMessage): void {
  vscode.postMessage(msg);
}

let started = false;

/** Attach the message listener and announce readiness. Call once, on mount. */
export function initBridge(): void {
  if (started) return;
  started = true;
  window.addEventListener("message", (event: MessageEvent<OutboundMessage>) => {
    const msg = event.data;
    if ("reqId" in msg) {
      const handler = pending.get(msg.reqId);
      if (handler && handler(msg)) pending.delete(msg.reqId);
      return;
    }
    switch (msg.type) {
      case "init":
      case "reloaded":
        schema.value = msg.schema;
        break;
      case "externalChange":
        schema.value = msg.schema;
        externalChangeCount.value++;
        showToast("Database was modified outside the editor — reloaded.");
        break;
      case "fatal":
        showToast(msg.message, true);
        break;
    }
  });
  post({ type: "ready" });
}
