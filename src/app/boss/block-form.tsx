import { router, Stack, useLocalSearchParams } from 'expo-router';
import React from 'react';
import { BlockForm } from '../../ui/BlockForm';
import { Screen } from '../../ui/Screen';
import { useBlock, useBump, useSettings, useStore } from '../../ui/store';

/** Create a block, or edit one with ?blockId=. */
export default function BlockFormScreen() {
  const { blockId } = useLocalSearchParams<{ blockId?: string }>();
  const store = useStore();
  const bump = useBump();
  const { update } = useSettings();
  const { data: block } = useBlock(blockId);
  const editing = !!blockId;

  if (editing && block === undefined) return <Screen>{null}</Screen>;

  return (
    <Screen>
      <Stack.Screen options={{ title: editing ? 'Edit block' : 'New block' }} />
      <BlockForm
        initial={editing ? block ?? null : null}
        submitLabel={editing ? 'Save block' : 'Create block'}
        onSubmit={async (b) => {
          await store.saveBlock(b);
          bump();
          if (editing) {
            router.back();
          } else {
            await update({ activeBlockId: b.id });
            router.replace(`/boss/${b.id}`);
          }
        }}
      />
    </Screen>
  );
}
