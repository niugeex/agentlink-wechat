import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TIMEOUTS } from '../src/constants.js';
import { AuthError, NetworkError } from '../src/errors.js';
import { UpdatesPoller } from '../src/polling/updater.js';

describe('UpdatesPoller', () => {
  it('persists cursor and dispatches messages', async () => {
    const seen: string[] = [];
    const poller = new UpdatesPoller(
      {
        post: async () => ({
          get_updates_buf: 'cursor-2',
          msgs: [
            {
              message_id: '1',
              from_user_id: 'user@im.wechat',
              to_user_id: 'bot@im.bot',
              create_time_ms: Date.now(),
              message_type: 1,
              message_state: 2,
              item_list: [],
              context_token: 'ctx',
            },
          ],
        }),
      } as never,
      {
        getCursor: async () => '',
        saveCursor: async (cursor) => { seen.push(cursor); },
        onMessage: async (raw) => { seen.push(String(raw.message_id)); },
        onLogout: async () => undefined,
        onError: () => undefined,
        getChannelVersion: () => '2.1.1',
        sleep: async () => undefined,
      },
    );

    const promise = poller.start();
    poller.stop();
    await promise;

    expect(seen).toContain('cursor-2');
  });

  it('triggers logout on session expiry', async () => {
    const onLogout = vi.fn(async () => undefined);
    const poller = new UpdatesPoller(
      {
        post: async () => { throw new AuthError('expired', -14); },
      } as never,
      {
        getCursor: async () => '',
        saveCursor: async () => undefined,
        onMessage: async () => undefined,
        onLogout,
        onError: () => undefined,
        getChannelVersion: () => '2.1.1',
        sleep: async () => undefined,
      },
    );

    await poller.start();
    expect(onLogout).toHaveBeenCalledWith('session_expired');
  });

  it('uses server-provided long-poll timeout for the next request', async () => {
    const timeouts: number[] = [];
    let calls = 0;
    const poller = new UpdatesPoller(
      {
        post: async (_path: string, _body: object, timeout?: number) => {
          timeouts.push(timeout ?? -1);
          calls += 1;
          if (calls === 1) {
            return { longpolling_timeout_ms: 12000, msgs: [] };
          }
          poller.stop();
          return { msgs: [] };
        },
      } as never,
      {
        getCursor: async () => '',
        saveCursor: async () => undefined,
        onMessage: async () => undefined,
        onLogout: async () => undefined,
        onError: () => undefined,
        getChannelVersion: () => '2.1.1',
        sleep: async () => undefined,
      },
    );

    await poller.start();

    expect(timeouts).toEqual([DEFAULT_TIMEOUTS.updates, 12000]);
  });
});


it('ignores long-poll timeouts without surfacing an error', async () => {
  const onError = vi.fn();
  let calls = 0;
  const poller = new UpdatesPoller(
    {
      post: async () => {
        calls += 1;
        if (calls === 1) {
          throw new NetworkError('timeout', undefined, { isTimeout: true });
        }
        return { get_updates_buf: 'cursor-2', msgs: [] };
      },
    } as never,
    {
      getCursor: async () => '',
      saveCursor: async () => undefined,
      onMessage: async () => undefined,
      onLogout: async () => undefined,
      onError,
      getChannelVersion: () => '2.1.1',
      sleep: async () => undefined,
    },
  );

  const promise = poller.start();
  await Promise.resolve();
  poller.stop();
  await promise;

  expect(onError).not.toHaveBeenCalled();
  expect(calls).toBe(1);
});
