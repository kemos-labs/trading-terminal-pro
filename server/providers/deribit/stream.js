/**
 * Deribit stream — single shared WS per product group, sequence gap → resnapshot, 10028 backoff.
 * Minimal stub for Phase 3; real WS wiring is Phase 8.
 */

export class DeribitStream {
  constructor({ onMessage, onGap } = {}) {
    this.onMessage = onMessage;
    this.onGap = onGap;
    this.seq = null;
    this.reconnectAttempts = 0;
  }

  handleMessage(msg) {
    if (msg?.params?.data?.prev_change_id != null) {
      const expected = this.seq != null ? this.seq + 1 : null;
      if (expected != null && msg.params.data.prev_change_id !== expected) {
        this.onGap?.(expected, msg.params.data.prev_change_id);
        this.seq = null;
        return { resnapshot: true };
      }
      this.seq = msg.params.data.change_id ?? this.seq;
    }
    this.onMessage?.(msg);
    return { resnapshot: false };
  }

  handleRateLimit(code) {
    if (code === 10028) {
      const jitter = Math.random() * 1000;
      const backoff = Math.min(30000, 1000 * Math.pow(2, this.reconnectAttempts) + jitter);
      this.reconnectAttempts++;
      return { backoff, shouldRetry: true };
    }
    return { backoff: 0, shouldRetry: false };
  }

  reset() {
    this.seq = null;
    this.reconnectAttempts = 0;
  }
}
