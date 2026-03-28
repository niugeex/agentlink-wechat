import { describe, expect, it } from 'vitest';
import { MessageItemType } from '../src/types/api.js';
import { extractText } from '../src/messaging/receiver.js';

describe('extractText', () => {
  it('combines reference, text and voice transcript', () => {
    const text = extractText([
      {
        type: MessageItemType.TEXT,
        ref_msg_item: { title: 'title', ref_body: 'body' },
        text_item: { text: 'hello' },
      },
      {
        type: MessageItemType.VOICE,
        voice_item: { text: 'voice' },
      },
    ]);

    expect(text).toBe('[引用: title | body]\nhello\nvoice');
  });
});
