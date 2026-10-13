import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { cardsPollDelay, usePolling } from "./use-polling";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("usePolling (#269)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("asks every `delay`, and at the new pace once it changes", () => {
    const poll = vi.fn();
    const { rerender } = renderHook(({ delay }) => usePolling(poll, delay), {
      initialProps: { delay: 30_000 as number | null },
    });

    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);

    rerender({ delay: 3_000 });
    vi.advanceTimersByTime(3_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("asks nothing on a null delay or in the background, and once on coming back", () => {
    const poll = vi.fn();
    const { rerender } = renderHook(({ delay }) => usePolling(poll, delay), {
      initialProps: { delay: null as number | null },
    });
    vi.advanceTimersByTime(60_000);
    expect(poll).not.toHaveBeenCalled();

    rerender({ delay: 3_000 });
    setVisibility("hidden");
    vi.advanceTimersByTime(60_000);
    expect(poll).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("stops when the screen goes away", () => {
    const poll = vi.fn();
    const { unmount } = renderHook(() => usePolling(poll, 3_000));
    unmount();
    vi.advanceTimersByTime(60_000);
    setVisibility("visible");
    expect(poll).not.toHaveBeenCalled();
  });
});

describe("cardsPollDelay (#269)", () => {
  it("is 3s while any run is under way, whatever else is there", () => {
    expect(
      cardsPollDelay([
        { status: "closed" },
        { status: "reweighing", runStage: "places" },
      ])
    ).toBe(3_000);
  });

  it("is 30s while any meeting is open to an answer", () => {
    for (const status of [
      "waiting_on_you",
      "waiting_on_others",
      "reweighing",
      "conflicting",
    ]) {
      expect(cardsPollDelay([{ status: "closed" }, { status }])).toBe(30_000);
    }
  });

  it("is null when nothing is open: closed, stuck, or no meetings", () => {
    expect(
      cardsPollDelay([{ status: "closed" }, { status: "stuck" }])
    ).toBeNull();
    expect(cardsPollDelay([])).toBeNull();
  });
});
