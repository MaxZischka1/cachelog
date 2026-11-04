import { MemoryStore } from './memoryStore';
import { runStoreContract } from './storeContract';

runStoreContract('MemoryStore', async () => new MemoryStore());

test('separate MemoryStore instances do not share data', async () => {
  const a = new MemoryStore();
  const b = new MemoryStore();
  await a.saveSettings({ deviceId: 'a', userName: 'A', role: 'planter' });
  expect(await b.getSettings()).toBeNull();
});
