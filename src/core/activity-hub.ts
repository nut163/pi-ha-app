import { randomUUID } from "node:crypto";

import type { ActivityEvent } from "./types.js";

export type ActivityInput = Omit<ActivityEvent, "id" | "createdAt"> & {
  createdAt?: string;
};

export type ActivityListener = (event: ActivityEvent) => void;
export type ActivityObserver = (event: ActivityEvent) => void | Promise<void>;

/**
 * Small in-process event bus used by the HTTP SSE endpoint and the agent UI.
 * Activity is intentionally session-scoped so one Home Assistant user never
 * receives another user's live tool trace.
 */
export class ActivityHub {
  private readonly listeners = new Map<string, Set<ActivityListener>>();
  private observer?: ActivityObserver;

  public setObserver(observer: ActivityObserver): void {
    this.observer = observer;
  }

  public emit(input: ActivityInput): ActivityEvent {
    const event: ActivityEvent = {
      ...input,
      id: randomUUID(),
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    void this.observer?.(event);
    for (const listener of this.listeners.get(event.sessionId) ?? []) {
      try {
        listener(event);
      } catch {
        // A disconnected browser must never interrupt a Home Assistant action.
      }
    }
    return event;
  }

  public subscribe(sessionId: string, listener: ActivityListener): () => void {
    const listeners = this.listeners.get(sessionId) ?? new Set<ActivityListener>();
    listeners.add(listener);
    this.listeners.set(sessionId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(sessionId);
    };
  }
}
