import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ContentMediaObjectStorage } from "@outbound/application/content/content-media";

export class S3ContentMediaStorage implements ContentMediaObjectStorage {
  readonly #client: S3Client;

  constructor(private readonly options: {
    readonly endpoint: string;
    readonly region: string;
    readonly bucket: string;
    readonly accessKeyId: string;
    readonly secretAccessKey: string;
    readonly forcePathStyle?: boolean;
  }) {
    this.#client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: options.forcePathStyle ?? true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(input: { readonly objectKey: string; readonly body: Uint8Array; readonly contentType: string }): Promise<void> {
    await this.#client.send(new PutObjectCommand({
      Bucket: this.options.bucket,
      Key: input.objectKey,
      Body: input.body,
      ContentType: input.contentType,
    }));
  }

  async get(input: { readonly objectKey: string; readonly maxBytes: number }): Promise<Uint8Array> {
    const object = await this.#client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: input.objectKey }));
    if (!object.Body) throw new Error("CONTENT_MEDIA_OBJECT_EMPTY");
    if (object.ContentLength !== undefined && object.ContentLength > input.maxBytes) throw new Error("CONTENT_MEDIA_OBJECT_TOO_LARGE");
    const bytes = await object.Body.transformToByteArray();
    if (bytes.byteLength > input.maxBytes) throw new Error("CONTENT_MEDIA_OBJECT_TOO_LARGE");
    return bytes;
  }
}
