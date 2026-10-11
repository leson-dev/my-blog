export interface AdminCspSources {
  apiOrigin: string;
  cognitoOrigin: string;
  /** Presigned POST target (the media bucket's regional endpoint). */
  uploadOrigin: string;
}

/** CSP for the admin SPA: its own scripts only; network only to the API, Cognito and S3 uploads. */
export function adminCsp(s: AdminCspSources): string {
  return [
    "default-src 'self'",
    // Shiki (preview highlighting) compiles its regex engine to WebAssembly.
    "script-src 'self' 'wasm-unsafe-eval'",
    // CodeMirror injects <style> elements; Shiki colours code with inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    // The preview shows uploaded images (blog /media/) and any https image written in Markdown.
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    `connect-src 'self' ${s.apiOrigin} ${s.cognitoOrigin} ${s.uploadOrigin}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
