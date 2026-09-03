// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActivityEvent, ApprovalRequest, ChatMessage, SessionSummary } from "../../src/core/types.js";
import { api } from "../../web/src/api";
import { ChatPanel } from "../../web/src/components/ChatPanel";

vi.mock("../../web/src/api", () => ({
  api: {
    streamMessage: vi.fn(),
    resolveApproval: vi.fn(),
  },
}));

const session: SessionSummary = {
  id: "session-1",
  title: "Home Assistant session",
  createdAt: "2026-09-02T18:00:00.000Z",
  updatedAt: "2026-09-02T18:00:00.000Z",
  messageCount: 1,
  active: true,
};

const messages: ChatMessage[] = [{
  id: "message-1",
  role: "user",
  content: "Turn on the studio lights",
  createdAt: "2026-09-02T18:00:01.000Z",
}];

const approval: ApprovalRequest = {
  id: "approval-1",
  sessionId: session.id,
  user: { id: "user-1", name: "Troy", displayName: "Troy", isAdmin: true },
  title: "Approve Call service",
  explanation: "This service call changes the state of your home.",
  operation: "Call service",
  target: "light.turn_on",
  risk: "MEDIUM",
  toolName: "ha_call_service",
  arguments: { domain: "light", service: "turn_on" },
  status: "pending",
  createdAt: "2026-09-02T18:00:03.000Z",
};

const activities: ActivityEvent[] = [
  {
    id: "activity-1",
    sessionId: session.id,
    kind: "status",
    title: "Thinking",
    detail: "Pi is interpreting the request.",
    status: "running",
    createdAt: "2026-09-02T18:00:02.000Z",
  },
  {
    id: "activity-2",
    sessionId: session.id,
    kind: "approval",
    title: "Approval required: Call service",
    detail: "This service call changes the state of your home.",
    status: "pending",
    risk: "MEDIUM",
    target: "light.turn_on",
    metadata: { approvalId: approval.id },
    createdAt: approval.createdAt,
  },
];

describe("chat activity timeline", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });
  afterEach(cleanup);

  it("renders thinking and pending approvals inside the conversation", async () => {
    const onApprovalResolved = vi.fn().mockResolvedValue(undefined);

    render(<ChatPanel
      session={session}
      messages={messages}
      activities={activities}
      approvals={[approval]}
      onRefresh={vi.fn().mockResolvedValue(undefined)}
      onApprovalResolved={onApprovalResolved}
      onActivity={vi.fn()}
    />);

    expect(screen.getByText("Thinking")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Approve Call service" })).toBeTruthy();
    expect(screen.queryByText("No pending approvals")).toBeNull();

    vi.mocked(api.resolveApproval).mockResolvedValue({ result: { content: "Rejected." } as never });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() => expect(api.resolveApproval).toHaveBeenCalledWith("approval-1", "rejected"));
    expect(onApprovalResolved).toHaveBeenCalledTimes(1);
  });
});
