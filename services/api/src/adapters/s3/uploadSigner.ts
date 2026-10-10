import type { S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { ImageContentType } from "@blog/shared";
import type { UploadSigner } from "../../usecases/ports";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const UPLOAD_EXPIRES_SECONDS = 300;

export class S3UploadSigner implements UploadSigner {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(s3: S3Client, bucket: string) {
    this.s3 = s3;
    this.bucket = bucket;
  }

  async sign(key: string, contentType: ImageContentType) {
    const { url, fields } = await createPresignedPost(this.s3, {
      Bucket: this.bucket,
      Key: key,
      Conditions: [
        ["content-length-range", 1, MAX_UPLOAD_BYTES],
        ["eq", "$Content-Type", contentType],
      ],
      Fields: { "Content-Type": contentType },
      Expires: UPLOAD_EXPIRES_SECONDS,
    });
    return { url, fields };
  }
}
