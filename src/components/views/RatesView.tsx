/**
 * Macros & Rates desk — 4 modes (Funding | UST | STIR | World).
 * Red function bar is the only mode switcher (no duplicate chip row).
 */
import { useEffect, useState, useCallback } from 'react';
import { useTerminalStore } from '../../store/terminalStore';
import { MacroPanel } from '../macrovol/MacroPanel';
import { StressStrip } from '../macrovol/StressStrip';
import { RatesPanel } from '../macrovol/RatesPanel';
import { SectionErrorBoundary } from '../common/SectionErrorBoundary';
import { RATES_SECTION_TO_MODE, RATES_SECTIONS } from '../../config/deskNav';
import { consumeDeskJumpOnMount } from '../../lib/market/deskJump';

type RatesMode = 'funding' | 'ust' | 'stir' | 'world';

function modeForSection(sectionId: string | null): RatesMode | null {
  if (!sectionId) return null;
  return RATES_SECTION_TO_MODE[sectionId] ?? null;
}

export function RatesView() {
  const deskSectionId = useTerminalStore((s) => s.deskSectionId);
  const [mode, setMode] = useState<RatesMode>(() => modeForSection(deskSectionId) ?? 'funding');

  // Red bar / function codes set deskSectionId — keep mode in sync.
  useEffect(() => {
    const m = modeForSection(deskSectionId);
    if (m) setMode(m);
  }, [deskSectionId]);

  // sessionStorage deep-link on mount
  useEffect(() => {
    let jumped: string | null = null;
    try {
      jumped = sessionStorage.getItem('desk.jump');
    } catch {
      /* ignore */
    }
    const m = modeForSection(jumped);
    if (m) setMode(m);
    return consumeDeskJumpOnMount();
  }, []);

  // Default section when entering Rates with no context
  useEffect(() => {
    const s = useTerminalStore.getState();
    if (s.activeTab !== 'rates') return;
    if (!s.deskSectionId || !modeForSection(s.deskSectionId)) {
      s.setDeskSection('rates-mode-funding');
    }
  }, []);

  const onModeReady = useCallback((m: RatesMode) => {
    setMode(m);
  }, []);
  void onModeReady;

  return (
    <div className="flex h-full flex-col overflow-hidden" data-testid="rates-view">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Macro only on Funding — saves space on STIR/UST/World */}
        {mode === 'funding' && (
          <section id="sec-macro" className="scroll-mt-8 border-b border-border/60" aria-label="US macro indicators">
            <SectionErrorBoundary name="Macro">
              <MacroPanel />
            </SectionErrorBoundary>
            <SectionErrorBoundary name="Stress">
              <StressStrip />
            </SectionErrorBoundary>
          </section>
        )}

        <section aria-label={`Rates · ${mode}`}>
          <SectionErrorBoundary name="Rates">
            <RatesPanel includeGlobalBlocks={false} mode={mode} />
          </SectionErrorBoundary>
        </section>
      </div>
      <span className="sr-only">
        {RATES_SECTIONS.find((s) => s.id === `rates-mode-${mode}`)?.label ?? mode}
      </span>
    </div>
  );
}
