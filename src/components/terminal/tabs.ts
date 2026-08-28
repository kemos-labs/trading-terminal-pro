import type { LucideIcon } from 'lucide-react';
import {
  Activity, Layers, Shield,
  Bitcoin, Landmark, BookOpen, Gem, Home,
} from 'lucide-react';

/**
 * Pro desk IA — 8 top-level desks. Home is the Launchpad (LPAD) landing desk;
 * Vol is the default market-data desk.
 * Greeks 1.0 lives under Vol · Greeks (not Trade, not a peer desk).
 * Academy is the on-platform learning hub. KSA is the Tadawul board.
 */
export type TabId = 'home' | 'vol' | 'positioning' | 'desk' | 'crypto' | 'rates' | 'academy' | 'ksa';

export interface TabDef {
  id: TabId;
  label: string;
  hotkey: string;
  icon: LucideIcon;
}

export const TABS: TabDef[] = [
  { id: 'home', label: 'Home', hotkey: '0', icon: Home },
  { id: 'vol', label: 'Vol', hotkey: '1', icon: Activity },
  { id: 'positioning', label: 'Flow', hotkey: '2', icon: Layers },
  { id: 'desk', label: 'Trade', hotkey: '3', icon: Shield },
  { id: 'crypto', label: 'Crypto', hotkey: '4', icon: Bitcoin },
  { id: 'rates', label: 'Rates', hotkey: '5', icon: Landmark },
  { id: 'academy', label: 'Academy', hotkey: '6', icon: BookOpen },
  { id: 'ksa', label: 'KSA', hotkey: '7', icon: Gem },
];