import React from 'react';
import { StyleSheet, Text } from 'react-native';
import type { BlockSheet } from '../core/types';
import { describePrescription } from '../import/pdfSheet';
import { Card } from './Card';
import { InfoRow, Muted } from './Section';
import { colors, font } from './theme';

const ha = (v: number) => `${v.toLocaleString('en-CA', { maximumFractionDigits: 2 })} ha`;

/** What was read off the block's map sheet: opening, areas and each prescription. */
export function SheetCard({ sheet }: { sheet: BlockSheet }) {
  return (
    <Card title="From the map sheet">
      {sheet.openingNumber ? <InfoRow label="Opening" value={sheet.openingNumber} /> : null}
      {sheet.plantAreaHa !== undefined ? <InfoRow label="Plant area" value={ha(sheet.plantAreaHa)} /> : null}
      {sheet.openingAreaHa !== undefined ? <InfoRow label="Opening area" value={ha(sheet.openingAreaHa)} /> : null}
      {sheet.operatingArea ? <InfoRow label="Operating area" value={sheet.operatingArea} /> : null}
      {sheet.prescriptions.map((rx, i) => (
        <React.Fragment key={i}>
          {sheet.prescriptions.length > 1 ? <Text style={styles.heading}>Prescription {i + 1}</Text> : null}
          {describePrescription(rx) ? <Text style={styles.rx}>{describePrescription(rx)}</Text> : null}
          {rx.startDate ? <InfoRow label="Plant start" value={rx.startDate} /> : null}
          {rx.plantType ? <InfoRow label="Plant type" value={rx.plantType} /> : null}
          {rx.access ? <InfoRow label="Access" value={rx.access} /> : null}
          {rx.seedlot ? <InfoRow label="Seedlot" value={rx.seedlot} /> : null}
          {rx.seedZone ? <InfoRow label="Seed zone" value={rx.seedZone} /> : null}
          {rx.age ? <InfoRow label="Age" value={rx.age} /> : null}
          {rx.nursery ? <InfoRow label="Nursery" value={rx.nursery} /> : null}
          {rx.orderNumber ? <InfoRow label="Order" value={rx.orderNumber} /> : null}
          {rx.deliveryDate ? <InfoRow label="Delivery" value={rx.deliveryDate} /> : null}
        </React.Fragment>
      ))}
      <Muted>Read from {sheet.source}. Check it against the paper copy.</Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: font.body, fontWeight: '700', color: colors.text, marginTop: 8 },
  rx: { fontSize: font.large, fontWeight: '700', color: colors.text },
});
