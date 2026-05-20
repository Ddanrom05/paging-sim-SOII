import { PCB, ProcessState } from "./types.js";

export class Dispatcher {
  private readyQueue: PCB[] = [];
  private currentProcess: PCB | null = null;
  quantum: number;
  private refsInCurrentQuantum: number = 0;

  constructor(quantum: number = 5) {
    this.quantum = quantum;
  }

  addProcess(pcb: PCB): void {
    pcb.state = ProcessState.READY;
    this.readyQueue.push(pcb);
  }

  removeProcess(pid: number): void {
    this.readyQueue = this.readyQueue.filter(p => p.pid !== pid);
    if (this.currentProcess?.pid === pid) {
      this.currentProcess = null;
      this.refsInCurrentQuantum = 0;
    }
  }

  hasProcesses(): boolean {
    return this.currentProcess !== null || this.readyQueue.length > 0;
  }

  getCurrentProcess(): PCB | null {
    return this.currentProcess;
  }

  getReadyQueue(): PCB[] {
    return this.readyQueue;
  }

  getRefsInCurrentQuantum(): number {
    return this.refsInCurrentQuantum;
  }

  /**
   * Returns the process that should execute next reference.
   * Handles quantum expiry and process switching.
   */
  nextProcess(): PCB | null {
    // If no current process, pick from ready queue
    if (!this.currentProcess) {
      if (this.readyQueue.length === 0) return null;
      this.currentProcess = this.readyQueue.shift()!;
      this.currentProcess.state = ProcessState.RUNNING;
      this.refsInCurrentQuantum = 0;
    }
    return this.currentProcess;
  }

  /**
   * Call after executing one reference for current process.
   * Returns true if quantum expired (process was preempted).
   */
  onRefExecuted(): boolean {
    this.refsInCurrentQuantum++;
    if (this.refsInCurrentQuantum >= this.quantum) {
      this.preempt();
      return true;
    }
    return false;
  }

  /**
   * Called when process has no more references (finished).
   */
  onProcessFinished(): void {
    this.currentProcess = null;
    this.refsInCurrentQuantum = 0;
  }

  private preempt(): void {
    if (this.currentProcess) {
      this.currentProcess.state = ProcessState.READY;
      this.readyQueue.push(this.currentProcess);
      this.currentProcess = null;
      this.refsInCurrentQuantum = 0;
    }
  }

  cloneState(): { currentPid: number | null; queuePids: number[]; refsInQuantum: number } {
    return {
      currentPid: this.currentProcess?.pid ?? null,
      queuePids: this.readyQueue.map(p => p.pid),
      refsInQuantum: this.refsInCurrentQuantum,
    };
  }

  restoreState(
    state: { currentPid: number | null; queuePids: number[]; refsInQuantum: number },
    pcbTable: Map<number, PCB>
  ): void {
    this.currentProcess = state.currentPid !== null ? (pcbTable.get(state.currentPid) ?? null) : null;
    this.readyQueue = state.queuePids.map(pid => pcbTable.get(pid)!).filter(Boolean);
    this.refsInCurrentQuantum = state.refsInQuantum;
  }
}
