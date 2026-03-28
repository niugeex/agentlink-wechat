import { describe, expect, it } from 'vitest';
import { TaskQueue } from '../src/utils/task-queue.js';

describe('TaskQueue', () => {
  it('limits concurrency', async () => {
    const queue = new TaskQueue(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      [1, 2, 3, 4].map((value) => queue.add(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return value;
      })),
    );

    expect(peak).toBe(2);
  });
});
