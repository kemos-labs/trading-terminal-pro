import type { PositionRow, Sign } from './exposure';

export type SignModelId = 'naive-calls-positive' | 'naive-puts-negative' | 'all-long' | 'flow-signed';

export interface SignModel {
  id: SignModelId;
  label: string;
  description: string;
  sign: (row: PositionRow & { putCall: 'call' | 'put'; flowSide?: 'buy' | 'sell' }) => Sign;
}

export const SIGN_MODELS: Record<SignModelId, SignModel> = {
  'naive-calls-positive': {
    id: 'naive-calls-positive',
    label: 'Calls + / Puts − (naive)',
    description: 'Assumes dealer short calls, long puts — scenario proxy, not observed book',
    sign: (r) => (r.putCall === 'call' ? 1 : -1) as Sign,
  },
  'naive-puts-negative': {
    id: 'naive-puts-negative',
    label: 'Puts + / Calls − (inverse naive)',
    description: 'Inverse naive assumption for scenario comparison',
    sign: (r) => (r.putCall === 'call' ? -1 : 1) as Sign,
  },
  'all-long': {
    id: 'all-long',
    label: 'All long (unsigned)',
    description: 'Unsigned exposure — magnitude only',
    sign: () => 1 as Sign,
  },
  'flow-signed': {
    id: 'flow-signed',
    label: 'Flow-signed',
    description: 'Uses taker side when available; falls back to naive',
    sign: (r) => {
      if (r.flowSide === 'buy') return (r.putCall === 'call' ? -1 : 1) as Sign;
      if (r.flowSide === 'sell') return (r.putCall === 'call' ? 1 : -1) as Sign;
      return (r.putCall === 'call' ? 1 : -1) as Sign;
    },
  },
};
