import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  // Some tests run in the node environment (`// @vitest-environment node`): no DOM to reset.
  if (typeof window === "undefined") return;
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
});
