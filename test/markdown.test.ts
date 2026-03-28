import { describe, expect, it } from 'vitest';
import { markdownToPlainText } from '../src/utils/markdown.js';

describe('markdownToPlainText', () => {
  it('removes markdown syntax while keeping readable text', () => {
    const input = '# Title\n\n```ts\nconst a = 1\n```\n![img](x)\n[text](https://example.com)\n| a | b |\n| - | - |';
    const output = markdownToPlainText(input);
    expect(output).toContain('const a = 1');
    expect(output).toContain('text');
    expect(output).not.toContain('![img]');
  });
});
