import type { LucideIcon } from 'lucide-react';
import {
  Activity, Layers, Shield,
  Bitcoin, Landmark, BookOpen, Gem, Home,
} from 'lucide-react';
import { DESK_REGISTRY, type DeskId } from '../../config/workflowRegistry';

/**
 * Pro desk IA — 8 top-level desks. Home is the Launchpad (LPAD) landing desk;
 * Vol is the default market-data desk.
 * Greeks 1.0 lives under Vol · Greeks (not Trade, not a peer desk).
 * Academy is the on-platform learning hub. KSA is the Tadawul board.
 */
export type TabId = DeskId;

export interface TabDef {
  id: TabId;
  label: string;
  hotkey: string;
  icon: LucideIcon;
}

const ICONS: Record<TabId, LucideIcon> = {
  home: Home,
  vol: Activity,
  positioning: Layers,
  desk: Shield,
  crypto: Bitcoin,
  rates: Landmark,
  academy: BookOpen,
  ksa: Gem,
};

export const TABS: TabDef[] = DESK_REGISTRY.map((desk) => ({
  id: desk.id,
  label: desk.label,
  hotkey: desk.hotkey,
  icon: ICONS[desk.id],
}));