import { describe, expect, it } from "vitest";
import { createUpload } from "../../src/usecases/uploads";
import { makeDeps } from "../fakes";

describe("createUpload", () => {
  it("puts uploads under media/<year>/ with a lowercase ulid and the right extension", async () => {
    const deps = makeDeps();
    const ticket = await createUpload(deps, { contentType: "image/webp" }, { e2e: false });
    expect(ticket.key).toMatch(/^media\/2026\/01j0+1\.webp$/);
    expect(ticket.publicUrl).toBe(`https://blog.oki-dev.xyz/${ticket.key}`);
    expect(ticket.fields["Content-Type"]).toBe("image/webp");
  });

  it("puts e2e uploads under media/e2e/", async () => {
    const deps = makeDeps();
    const ticket = await createUpload(deps, { contentType: "image/png" }, { e2e: true });
    expect(ticket.key).toMatch(/^media\/e2e\/[0-9a-z]+\.png$/);
  });
});
