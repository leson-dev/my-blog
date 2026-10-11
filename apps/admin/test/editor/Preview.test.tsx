import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Preview } from "../../src/editor/Preview";

describe("Preview", () => {
  it("renders the title and the HTML from the shared Markdown pipeline", async () => {
    const renderMd = vi.fn(async (md: string) => `<p>${md.toUpperCase()}</p>`);
    render(<Preview title="Học AWS" markdown="xin chào" render={renderMd} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Học AWS");
    expect(await screen.findByText("XIN CHÀO")).toBeTruthy();
  });

  it("shows a rendering error as text", async () => {
    render(
      <Preview
        title="x"
        markdown="x"
        render={async () => {
          throw new Error("<b>boom</b>");
        }}
      />,
    );
    expect((await screen.findByRole("alert")).textContent).toBe("Lỗi xem trước: <b>boom</b>");
  });
});
