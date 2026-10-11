/**
 * EMVCo / Thai QR (PromptPay) payload generator with CRC16-CCITT.
 * Used for gateway-less display and by the mock gateway. A static PromptPay QR
 * has no automatic confirmation — production must use a payment gateway that
 * posts a server-side confirmation (see adapters/payment).
 */
function tlv(id: string, value: string) {
  return id + String(value.length).padStart(2, '0') + value;
}

export function crc16(s: string): string {
  let crc = 0xffff;
  for (const b of Buffer.from(s, 'utf8')) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function promptPayPayload(target: string, amount?: number, reference?: string): string {
  const id = target.replace(/[^0-9]/g, '');
  let acct: string;
  if (id.length >= 15) acct = tlv('03', id); // e-wallet
  else if (id.length >= 13) acct = tlv('02', id); // national / tax id
  else acct = tlv('01', ('0000000000000' + id.replace(/^0/, '66')).slice(-13)); // mobile
  const merchant = tlv('29', tlv('00', 'A000000677010111') + acct);
  let p = tlv('00', '01') + tlv('01', amount ? '12' : '11') + merchant + tlv('53', '764') + tlv('58', 'TH');
  if (amount) p += tlv('54', amount.toFixed(2));
  if (reference) p += tlv('62', tlv('05', reference.slice(0, 25)));
  p += '6304';
  return p + crc16(p);
}
