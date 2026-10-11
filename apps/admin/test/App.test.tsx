import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../src/App";
import { renderWithServices } from "./render";

describe("App", () => {
  it("shows a not-found page for unknown paths", async () => {
    history.replaceState(null, "", "/khong-co");
    renderWithServices(<App />);
    expect(await screen.findByText(/Không có trang này/)).toBeTruthy();
  });
});
