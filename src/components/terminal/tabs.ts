import type { LucideIcon } from 'lucide-react';
import {
  Activity, Layers, Shield,
  Bitcoin, Landmark, BookOpen, Gem,
} from 'lucide-react';

/**
 * Pro desk IA — 7 top-level desks. Vol is the default landing desk.
 * Greeks 1.0 lives under Vol · Greeks (not Trade, not a peer desk).
 * Academy is the on-platform learning hub. KSA is the Tadawul board.
 */
export type TabId = 'vol' | 'positioning' | 'desk' | 'crypto' | 'rates' | 'academy' | 'ksa';

export interface TabDef {
  id: TabId;
  label: string;
  hotkey: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { id: 'vol', label: 'Vol', hotkey: '1', icon: Activity },
  { id: 'positioning', label: 'Flow', hotkey: '2', icon: Layers },
  { id: 'desk', label: 'Trade', hotkey: '3', icon: Shield },
  { id: 'crypto', label: 'Crypto', hotkey: '4', icon: Bitcoin },
  { id: 'rates', label: 'Rates', hotkey: '5', icon: Landmark },
  { id: 'academy', label: 'Academy', hotkey: '6', icon: BookOpen },
  { id: 'ksa', label: 'KSA', hotkey: '7', icon: Gem },
];
