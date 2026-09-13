export function wrapContentText(value: string, maxCharacters: number, maxLines: number): readonly string[] {
  const words: string[] = [];
  for (const token of value.trim().replace(/\s+/g, " ").split(" ").filter(Boolean)) {
    // A closing punctuation mark is not a word and must not occupy its own line.
    if (words.length && /^[?!:;»]+$/.test(token)) words[words.length - 1] += ` ${token}`;
    else words.push(token);
  }
  const lines: string[] = [];
  for (const word of words) {
    const current = lines.at(-1);
    if (!current || `${current} ${word}`.length > maxCharacters) lines.push(word);
    else lines[lines.length - 1] = `${current} ${word}`;
    if (lines.length > maxLines) break;
  }
  const retained = lines.slice(0, maxLines);
  if (lines.length > maxLines && retained.length) retained[retained.length - 1] = `${retained.at(-1)!.replace(/[.…]+$/, "")}…`;
  return retained.length ? retained : [""];
}

