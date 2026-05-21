declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const workerSrc: string;
  export default workerSrc;
}

declare module "mammoth/mammoth.browser" {
  export function extractRawText(input: {
    arrayBuffer: ArrayBuffer;
  }): Promise<{ value: string; messages: unknown[] }>;
}
