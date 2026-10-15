/** Minimal, dependency-free XML parser: elements, attributes, text. No DTD/entity expansion (so no billion-laughs). Namespace prefixes are dropped. */
import { TidepullError } from "../core/errors.ts";

export interface XNode {
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  text: string;
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decode = (s: string) =>
  s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|(\w+));/gi, (m, hex?: string, dec?: string, name?: string) => {
    if (hex) return String.fromCodePoint(parseInt(hex, 16));
    if (dec) return String.fromCodePoint(Number(dec));
    return ENT[name ?? ""] ?? m;
  });
const local = (n: string) => n.slice(n.indexOf(":") + 1);

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const MAX_DEPTH = 64;

export function parseXml(src: string): XNode {
  const root: XNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack: XNode[] = [root];
  let m: RegExpExecArray | null;
  TOKEN.lastIndex = 0;
  while ((m = TOKEN.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3]) {
      const name = local(m[3]);
      if (m[2]) {
        if (stack.length < 2 || stack[stack.length - 1].name !== name) throw new TidepullError(`Malformed XML: unexpected </${name}>`);
        stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      let a: RegExpExecArray | null;
      ATTR.lastIndex = 0;
      while ((a = ATTR.exec(m[4] ?? ""))) attrs[local(a[1])] = decode(a[2] ?? a[3] ?? "");
      const node: XNode = { name, attrs, children: [], text: "" };
      top.children.push(node);
      if (!m[5]) {
        if (stack.length > MAX_DEPTH) throw new TidepullError("XML nesting too deep");
        stack.push(node);
      }
    }
  }
  if (stack.length !== 1) throw new TidepullError("Malformed XML: unclosed element");
  const el = root.children[0];
  if (!el) throw new TidepullError("Malformed XML: no root element");
  return el;
}

export const child = (n: XNode, name: string): XNode | undefined => n.children.find((c) => c.name === name);
export const kids = (n: XNode, name: string): XNode[] => n.children.filter((c) => c.name === name);
