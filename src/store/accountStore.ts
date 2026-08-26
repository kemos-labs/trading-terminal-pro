/**
 * Account + billing gate state. Separate from terminalStore to keep market
 * data concerns isolated; consumed by the header acct button, BillingDialog
 * and the desk paywall.
 */
import { create } from 'zustand';
import { fetchMe, logout as apiLogout, type AccountUser, type GateInfo } from '../lib/auth';

interface AccountState {
  user: AccountUser | null;
  gate: GateInfo | null;
  billingConfigured: boolean;
  billingOpen: boolean;
  setBillingOpen: (open: boolean) => void;
  /** Re-fetch /api/auth/me — call on app boot and after login/logout/checkout. */
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Desk access check — open when billing unconfigured or desk not gated. */
  deskAllowed: (tab: string) => boolean;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  user: null,
  gate: null,
  billingConfigured: false,
  billingOpen: false,

  setBillingOpen: (open) => set({ billingOpen: open }),

  refresh: async () => {
    try {
      const me = await fetchMe();
      set({
        user: me.user,
        gate: me.gate,
        billingConfigured: me.billingConfigured,
        // Close the dialog once an entitled session appears (post-redirect).
        billingOpen: me.gate?.entitled ? false : get().billingOpen,
      });
    } catch {
      // Fail-open UI-side; server endpoints still enforce for gated desks.
    }
  },

  signOut: async () => {
    try {
      await apiLogout();
    } finally {
      await get().refresh();
    }
  },

  deskAllowed: (tab) => {
    const { gate } = get();
    if (!gate?.enabled || !gate.gatedDesks?.length) return true;
    if (gate.entitled) return true;
    return !gate.gatedDesks.includes(tab as never);
  },
}));
