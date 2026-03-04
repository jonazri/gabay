import { describe, it, expect, vi } from 'vitest';
import { notifyMainGroup } from './notify.js';

describe('notifyMainGroup', () => {
  it('sends message to the main group JID', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const registeredGroups = {
      'main-jid@g.us': { name: 'Main', folder: 'main', isMain: true },
      'other-jid@g.us': { name: 'Other', folder: 'other' },
    };

    await notifyMainGroup(
      registeredGroups as any,
      sendMessage,
      'test notification',
    );

    expect(sendMessage).toHaveBeenCalledWith(
      'main-jid@g.us',
      'test notification',
    );
  });

  it('does nothing when no main group exists', async () => {
    const sendMessage = vi.fn();
    const registeredGroups = {
      'other-jid@g.us': { name: 'Other', folder: 'other' },
    };

    await notifyMainGroup(registeredGroups as any, sendMessage, 'test');

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
