import { afterEach, describe, expect, it } from "vitest";
import { LAST_TAB_KEY, OPEN_ON_KEY, entryRoute, rememberTab } from "../startPage";

const TABS = ["/lcms", "/ftir", "/plate-reader", "/ai"];

afterEach(() => window.localStorage.clear());

describe("start page", () => {
  it("opens on Home for a new browser", () => {
    expect(entryRoute(TABS)).toBe("/home");
  });

  it("opens on the last analysis tab when asked to", () => {
    rememberTab("/plate-reader", TABS);
    expect(entryRoute(TABS)).toBe("/home");
    window.localStorage.setItem(OPEN_ON_KEY, JSON.stringify("last"));
    expect(entryRoute(TABS)).toBe("/plate-reader");
  });

  it("does not remember Home or unknown pages as the last tab", () => {
    rememberTab("/ftir", TABS);
    rememberTab("/home", TABS);
    rememberTab("/somewhere", TABS);
    expect(window.localStorage.getItem(LAST_TAB_KEY)).toBe("/ftir");
  });
});
