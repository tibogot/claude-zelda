/** Binary ↔ base64 and shallow plain-object merge (terrain JSON + param overlays). */

export function bufferToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, Math.min(i + chunk, bytes.length)),
    );
  }
  return btoa(binary);
}

export function base64ToBuffer(b64) {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out.buffer;
}

/** Shallow-merge nested plain objects (for JSON import overlays). */
export function mergePlainDeep(target, src) {
  if (!src || typeof src !== "object" || Array.isArray(src)) return;
  for (const key of Object.keys(src)) {
    const sv = src[key];
    if (
      sv !== null &&
      typeof sv === "object" &&
      !Array.isArray(sv) &&
      target[key] &&
      typeof target[key] === "object" &&
      !Array.isArray(target[key])
    ) {
      mergePlainDeep(target[key], sv);
    } else {
      target[key] = sv;
    }
  }
}
