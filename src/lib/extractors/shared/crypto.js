import crypto from "node:crypto";

function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function base64DecodeLatin1(input) {
  return Buffer.from(input, "base64").toString("latin1");
}

function decodeBase64Url(input) {
  const base64 = String(input)
    .replaceAll("-", "+")
    .replaceAll("_", "/");
  const padding = base64.length % 4 === 2 ? "==" : base64.length % 4 === 3 ? "=" : "";
  return Buffer.from(base64 + padding, "base64");
}

function decryptVoePayload(input) {
  const patternsRegex = /@\$|\^\^|~@|%\?|\*~|!!|#&/g;
  const v1 = rot13(input);
  const v2 = v1.replace(patternsRegex, "_");
  const v3 = v2.replaceAll("_", "");
  const v4 = base64DecodeLatin1(v3);
  const v5 = Array.from(v4, (char) => String.fromCharCode(char.charCodeAt(0) - 3)).join("");
  const v6 = v5.split("").reverse().join("");
  const decoded = base64DecodeLatin1(v6);
  return JSON.parse(decoded);
}

function decryptFilemoonPlayback(playback) {
  const key = Buffer.concat((playback.key_parts || []).map((part) => decodeBase64Url(part)));
  const iv = decodeBase64Url(playback.iv);
  const payload = decodeBase64Url(playback.payload);
  const tag = payload.subarray(payload.length - 16);
  const encrypted = payload.subarray(0, payload.length - 16);

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export {
  rot13,
  base64DecodeLatin1,
  decodeBase64Url,
  decryptVoePayload,
  decryptFilemoonPlayback
};
