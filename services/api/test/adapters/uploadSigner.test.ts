import { S3Client } from "@aws-sdk/client-s3";
import { describe, expect, it } from "vitest";
import { MAX_UPLOAD_BYTES, S3UploadSigner } from "../../src/adapters/s3/uploadSigner";

const signer = new S3UploadSigner(
  new S3Client({
    region: "ap-northeast-1",
    credentials: { accessKeyId: "AKIATEST", secretAccessKey: "secret" },
  }),
  "blog-media",
);

describe("S3UploadSigner", () => {
  it("signs a POST policy that pins the key, content type and size range", async () => {
    const { url, fields } = await signer.sign("media/2026/abc.webp", "image/webp");
    expect(url).toContain("blog-media");
    expect(fields.key).toBe("media/2026/abc.webp");
    expect(fields["Content-Type"]).toBe("image/webp");
    const policy = JSON.parse(Buffer.from(fields.Policy ?? "", "base64").toString("utf8"));
    expect(policy.conditions).toEqual(
      expect.arrayContaining([
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", "image/webp"],
      ]),
    );
  });
});
