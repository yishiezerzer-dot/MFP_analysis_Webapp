import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useUndoRedo } from "../useUndoRedo";

describe("useUndoRedo", () => {
  it("initializes with provided state and empty history", () => {
    const { result } = renderHook(() => useUndoRedo("initial"));

    expect(result.current.state).toBe("initial");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("records history on set and supports undo/redo", () => {
    const { result } = renderHook(() => useUndoRedo<number>(10));

    act(() => {
      result.current.set(20);
    });

    expect(result.current.state).toBe(20);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.set(30);
    });

    expect(result.current.state).toBe(30);
    expect(result.current.canUndo).toBe(true);

    // Undo to 20
    act(() => {
      result.current.undo();
    });

    expect(result.current.state).toBe(20);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    // Undo to 10
    act(() => {
      result.current.undo();
    });

    expect(result.current.state).toBe(10);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    // Redo to 20
    act(() => {
      result.current.redo();
    });

    expect(result.current.state).toBe(20);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(true);

    // Redo to 30
    act(() => {
      result.current.redo();
    });

    expect(result.current.state).toBe(30);
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("clears redo history when a new state is pushed", () => {
    const { result } = renderHook(() => useUndoRedo("A"));

    act(() => {
      result.current.set("B");
    });
    act(() => {
      result.current.undo();
    });

    expect(result.current.state).toBe("A");
    expect(result.current.canRedo).toBe(true);

    // New action branches away from redo stack
    act(() => {
      result.current.set("C");
    });

    expect(result.current.state).toBe("C");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);
  });

  it("supports updater function in set", () => {
    const { result } = renderHook(() => useUndoRedo<number>(5));

    act(() => {
      result.current.set((prev) => prev * 2);
    });

    expect(result.current.state).toBe(10);

    act(() => {
      result.current.undo();
    });

    expect(result.current.state).toBe(5);
  });

  it("resets state and clears history", () => {
    const { result } = renderHook(() => useUndoRedo("start"));

    act(() => {
      result.current.set("step1");
    });
    act(() => {
      result.current.set("step2");
    });

    expect(result.current.canUndo).toBe(true);

    act(() => {
      result.current.reset("fresh");
    });

    expect(result.current.state).toBe("fresh");
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });
});
