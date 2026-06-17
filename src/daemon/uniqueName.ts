const ADJ = ['Swift', 'Calm', 'Bright', 'Bold', 'Keen', 'Wise', 'Far', 'Deep'];
const NOUN = ['Lake', 'Ridge', 'Grove', 'Coast', 'Peak', 'Vale', 'Cove', 'Mesa'];
let counter = 0;

export function uniqueName(): string {
  const n = counter++;
  const adj = ADJ[n % ADJ.length];
  const noun = NOUN[Math.floor(n / ADJ.length) % NOUN.length];
  return `${adj}${noun}${n.toString(36)}`;
}
