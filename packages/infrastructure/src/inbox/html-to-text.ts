import { parse } from "node-html-parser";

export function htmlToText(value: string | null): string | null {
  if (!value) return null;
  const root = parse(value, {
    comment: false,
    blockTextElements: { script: false, style: false, pre: true },
  });
  for (const element of root.querySelectorAll("script,style,iframe,object,embed,svg,math,template")) {
    element.remove();
  }
  const text = root.structuredText
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || null;
}
