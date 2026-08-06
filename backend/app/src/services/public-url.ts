import dns from "node:dns/promises";
import net from "node:net";

function isPrivateIp(address: string) {
  const mappedIpv4 = address.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (mappedIpv4) return isPrivateIp(mappedIpv4);
  if (address === "::1" || address.startsWith("fc") || address.startsWith("fd") || address.startsWith("fe80:")) return true;
  if (!net.isIPv4(address)) return false;
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export async function assertPublicUrl(rawUrl: string) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("仅支持 HTTP(S) 链接");
  if (!url.hostname || url.username || url.password) throw new Error("链接格式不安全");
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw new Error("禁止访问内网或本机地址");
  return url;
}
