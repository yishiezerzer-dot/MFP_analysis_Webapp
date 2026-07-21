import type { HandleUploadBody } from "@vercel/blob/client";
import { handleUpload } from "@vercel/blob/client";

export const config = {
  runtime: "nodejs",
};

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const json = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "application/octet-stream",
          "application/xml",
          "text/xml",
          "text/csv",
          "text/plain",
          "application/vnd.ms-excel",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ],
        maximumSizeInBytes: 512 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {},
    });
    return Response.json(json);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Blob upload failed" },
      { status: 400 },
    );
  }
}
