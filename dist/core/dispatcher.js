import { ProcessState } from "./types.js";
export class Dispatcher {
    constructor(quantum = 5) {
        this.readyQueue = [];
        this.currentProcess = null;
        this.refsInCurrentQuantum = 0;
        this.quantum = quantum;
    }
    addProcess(pcb) {
        pcb.state = ProcessState.READY;
        this.readyQueue.push(pcb);
    }
    removeProcess(pid) {
        this.readyQueue = this.readyQueue.filter(p => p.pid !== pid);
        if (this.currentProcess?.pid === pid) {
            this.currentProcess = null;
            this.refsInCurrentQuantum = 0;
        }
    }
    hasProcesses() {
        return this.currentProcess !== null || this.readyQueue.length > 0;
    }
    getCurrentProcess() {
        return this.currentProcess;
    }
    getReadyQueue() {
        return this.readyQueue;
    }
    getRefsInCurrentQuantum() {
        return this.refsInCurrentQuantum;
    }
    /**
     * Returns the process that should execute next reference.
     * Handles quantum expiry and process switching.
     */
    nextProcess() {
        // If no current process, pick from ready queue
        if (!this.currentProcess) {
            if (this.readyQueue.length === 0)
                return null;
            this.currentProcess = this.readyQueue.shift();
            this.currentProcess.state = ProcessState.RUNNING;
            this.refsInCurrentQuantum = 0;
        }
        return this.currentProcess;
    }
    /**
     * Call after executing one reference for current process.
     * Returns true if quantum expired (process was preempted).
     */
    onRefExecuted() {
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
    onProcessFinished() {
        this.currentProcess = null;
        this.refsInCurrentQuantum = 0;
    }
    preempt() {
        if (this.currentProcess) {
            this.currentProcess.state = ProcessState.READY;
            this.readyQueue.push(this.currentProcess);
            this.currentProcess = null;
            this.refsInCurrentQuantum = 0;
        }
    }
    cloneState() {
        return {
            currentPid: this.currentProcess?.pid ?? null,
            queuePids: this.readyQueue.map(p => p.pid),
            refsInQuantum: this.refsInCurrentQuantum,
        };
    }
    restoreState(state, pcbTable) {
        this.currentProcess = state.currentPid !== null ? (pcbTable.get(state.currentPid) ?? null) : null;
        this.readyQueue = state.queuePids.map(pid => pcbTable.get(pid)).filter(Boolean);
        this.refsInCurrentQuantum = state.refsInQuantum;
    }
}
