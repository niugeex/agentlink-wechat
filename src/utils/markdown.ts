export function markdownToPlainText(input: string): string {
  return input
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^\|?[\s:-]+\|?$/gm, '')
    .replace(/\|/g, ' ')
    .trim();
}
