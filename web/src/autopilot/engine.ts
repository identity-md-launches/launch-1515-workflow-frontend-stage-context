import type { Address, Hex } from "viem";
import { same } from "../logic";
import {
  validateDecision,
  type Brain,
  type Decision,
  type Snapshot,
  type ValidAction,
} from "./model";
export type Activity = {
  id: string;
  time: number;
  brain: Brain;
  decision: string;
  reason: string;
  hash?: Hex;
};
export class PendingTransactionError extends Error {}
export type EngineDependencies = {
  agent: Address;
  size: bigint;
  brain: Brain;
  read: (sample: boolean, signal: AbortSignal) => Promise<Snapshot>;
  decide: (snapshot: Snapshot, signal: AbortSignal) => Promise<Decision>;
  send: (
    action: ValidAction,
    signal: AbortSignal,
    onHash: (hash: Hex) => void,
  ) => Promise<Hex>;
  activity: (entry: Activity) => void;
  state: (running: boolean, reason: string, busy: boolean) => void;
  safe: (error: unknown) => string;
};
/** All async boundaries before a broadcast honor Stop. Submitted transactions cannot be cancelled by Stop. */
export class AutopilotEngine {
  running = false;
  busy = false;
  failures = 0;
  private timer?: ReturnType<typeof setInterval>;
  private controller = new AbortController();
  constructor(
    private d: EngineDependencies,
    private interval = 60_000,
  ) {}
  start() {
    if (this.running || this.busy) return;
    this.running = true;
    this.failures = 0;
    this.controller = new AbortController();
    this.d.state(true, "Running. Checking the card…", false);
    this.timer = setInterval(() => void this.tick(), this.interval);
    void this.tick();
  }
  stop(reason = "Stopped. No new trades will be sent.") {
    this.running = false;
    clearInterval(this.timer);
    this.controller.abort();
    this.d.state(false, reason, this.busy);
  }
  async tick() {
    if (!this.running || this.busy) return;
    this.busy = true;
    const signal = this.controller.signal;
    const active = () => this.running && !signal.aborted;
    const entry: Activity = {
      id: crypto.randomUUID(),
      time: Date.now(),
      brain: this.d.brain,
      decision: "hold",
      reason: "",
    };
    let sending = false;
    this.d.state(true, "Checking prices and card limits…", true);
    try {
      let snapshot = await this.d.read(true, signal);
      if (!active()) return;
      if (snapshot.card.frozen || !same(snapshot.card.agent, this.d.agent)) {
        entry.decision = "stopped";
        entry.reason = snapshot.card.frozen
          ? "Card is frozen."
          : "Agent assignment changed.";
        this.stop(entry.reason);
        return;
      }
      const decision = await this.d.decide(snapshot, signal);
      if (!active()) return;
      entry.decision = decision.action;
      entry.reason = decision.reason;
      let action = validateDecision(
        decision,
        snapshot,
        this.d.agent,
        this.d.size,
      );
      if (!action) return;
      // Re-read balances, limits, positions and eligibility after the brain responds.
      snapshot = await this.d.read(false, signal);
      if (!active()) return;
      action = validateDecision(decision, snapshot, this.d.agent, this.d.size);
      if (!action) return;
      sending = true;
      this.d.state(true, "Re-quoting and simulating the trade…", true);
      const hash = await this.d.send(action, signal, (hash) => {
        entry.hash = hash;
        entry.decision = `${decision.action} submitted`;
        this.d.activity({ ...entry });
      });
      entry.hash = hash;
      entry.decision = `${decision.action} confirmed`;
      this.failures = 0;
    } catch (e) {
      if (!active() && !entry.hash) return;
      const reason = this.d.safe(e);
      entry.decision = sending ? "trade failed" : "skipped";
      entry.reason = reason;
      if (sending) {
        this.failures++;
        if (e instanceof PendingTransactionError) this.stop(reason);
        else if (this.failures >= 3) {
          entry.reason = `Stopped after 3 failed sends in a row. ${reason}`;
          this.stop(entry.reason);
        }
      }
    } finally {
      if (
        signal.aborted &&
        !entry.hash &&
        ["hold", "buy", "sell"].includes(entry.decision)
      ) {
        entry.decision = "stopped";
        entry.reason = "Stopped before broadcast. No trade was sent.";
      }
      if (entry.reason) this.d.activity(entry);
      this.busy = false;
      this.d.state(
        this.running,
        this.running
          ? `Running. Next check every ${this.interval / 1000} seconds.`
          : "",
        false,
      );
    }
  }
}
