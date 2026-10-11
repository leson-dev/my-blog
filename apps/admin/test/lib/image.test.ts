import { describe, expect, it, vi } from "vitest";
import {
  altFromFileName,
  fitWithin,
  imageMarkdown,
  MAX_UPLOAD_BYTES,
  uploadImage,
} from "../../src/lib/image";

const ticket = {
  url: "https://media-bucket.s3.ap-northeast-1.amazonaws.com/",
  fields: { key: "media/2026/01J.webp", "Content-Type": "image/webp", Policy: "p" },
  key: "media/2026/01J.webp",
  publicUrl: "https://blog.oki-dev.xyz/media/2026/01J.webp",
};

function setup(blob = new Blob(["x"], { type: "image/webp" }), status = 204) {
  const api = { createUpload: vi.fn(async () => ticket) };
  const fetch = vi.fn(async () => new Response(null, { status }));
  const prepare = vi.fn(async () => ({ blob, contentType: "image/webp" as const }));
  return { api, fetch, prepare };
}

describe("fitWithin", () => {
  it.each([
    [4000, 3000, { width: 1600, height: 1200 }],
    [1200, 2400, { width: 800, height: 1600 }],
    [800, 600, { width: 800, height: 600 }],
  ])("%i×%i", (w, h, expected) => {
    expect(fitWithin(w, h)).toEqual(expected);
  });
});

describe("uploadImage", () => {
  it("posts the presigned fields, then the file, and returns the public URL", async () => {
    const { api, fetch, prepare } = setup();
    const file = new File(["raw"], "anh.png", { type: "image/png" });
    await expect(uploadImage(api, file, { prepare, fetch })).resolves.toBe(ticket.publicUrl);

    expect(api.createUpload).toHaveBeenCalledWith("image/webp");
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(ticket.url);
    const form = init.body as FormData;
    expect([...form.keys()]).toEqual(["key", "Content-Type", "Policy", "file"]);
  });

  it("refuses files that are not images", async () => {
    const { api, fetch, prepare } = setup();
    const file = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
    await expect(uploadImage(api, file, { prepare, fetch })).rejects.toThrow("không phải ảnh");
    expect(api.createUpload).not.toHaveBeenCalled();
  });

  it("refuses images still over 10 MB after compression", async () => {
    const big = new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)], { type: "image/webp" });
    const { api, fetch, prepare } = setup(big);
    const file = new File(["x"], "big.png", { type: "image/png" });
    await expect(uploadImage(api, file, { prepare, fetch })).rejects.toThrow("10 MB");
  });

  it("reports an S3 rejection", async () => {
    const { api, fetch, prepare } = setup(undefined, 403);
    const file = new File(["x"], "a.png", { type: "image/png" });
    await expect(uploadImage(api, file, { prepare, fetch })).rejects.toThrow("HTTP 403");
  });
});

describe("markdown helpers", () => {
  it("builds the image tag with a clean alt text", () => {
    expect(altFromFileName("Mùa thu [Kyoto].final.png")).toBe("Mùa thu Kyoto.final");
    expect(imageMarkdown("https://x/a.webp", "a")).toBe("![a](https://x/a.webp)");
  });
});
