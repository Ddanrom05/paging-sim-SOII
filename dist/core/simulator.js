import { PCB, PCBTable, MemoryManager, FrameInfo, ProcessState, } from "./types.js";
import { ARCAlgorithm } from "./arc.js";
import { Dispatcher } from "./dispatcher.js";
let pidCounter = 1;
export class PagingSimulator {
    constructor(totalFrames = 8, quantum = 5, _clockCycle = 3) {
        this.pcbTable = new PCBTable();
        this.history = [];
        this.clockTick = 0;
        this.totalPageFaults = 0;
        this.finishedProcesses = [];
        this.totalFrames = totalFrames;
        this.quantum = quantum;
        this.clockCycle = _clockCycle;
        this.memoryManager = new MemoryManager(totalFrames);
        this.dispatcher = new Dispatcher(quantum);
        this.arc = new ARCAlgorithm(totalFrames);
    }
    addProcess(name, numPages, refs, originNodeId) {
        if (refs.some(r => r < 0 || r >= numPages))
            return null;
        const pcb = new PCB(pidCounter++, name, numPages, refs, originNodeId);
        pcb.arrivalTime = this.clockTick;
        this.pcbTable.add(pcb);
        this.dispatcher.addProcess(pcb);
        return pcb;
    }
    step() {
        const current = this.dispatcher.nextProcess();
        if (!current)
            return { pageFault: false, noProcesses: true };
        if (!current.hasRefs()) {
            this.terminateProcess(current);
            return {
                pageFault: false,
                processFinished: true,
                finishedPid: current.pid,
                finishedName: current.name,
            };
        }
        this.captureState(); // save for undo
        const page = current.getNextRef();
        const entry = current.pageTable.getEntry(page);
        let result = { pageFault: false, ref: page, currentPid: current.pid };
        if (entry.isPresent()) {
            // Cache hit
            const frame = entry.getFrameNumber();
            entry.setReferenced(true);
            this.arc.onPageAccess(frame);
        }
        else {
            // Page fault
            this.totalPageFaults++;
            current.pageFaults++;
            result.pageFault = true;
            result.faultPage = page;
            if (this.memoryManager.isFull()) {
                // Need to evict
                const victim = this.arc.selectVictim(this.memoryManager.getFrameOwnerMap(), this.pcbTable);
                if (victim) {
                    const victimPcb = this.pcbTable.get(victim.ownerPid);
                    const victimFrame = this.findFrame(victim.ownerPid, victim.virtualPage);
                    result.evictedPid = victim.ownerPid;
                    result.evictedPage = victim.virtualPage;
                    result.evictedFrame = victimFrame ?? undefined;
                    if (victimPcb) {
                        this.arc.onPageEvict(victimFrame, victim.virtualPage);
                        this.evictPage(victimPcb, victim.virtualPage, victimFrame);
                    }
                }
            }
            this.loadPage(current, page);
        }
        current.advanceRef();
        this.clockTick++;
        // Check quantum expiry
        const quantumExpired = this.dispatcher.onRefExecuted();
        result.quantumExpired = quantumExpired;
        // Check if process has no refs left
        if (!current.hasRefs()) {
            this.terminateProcess(current);
            result.processFinished = true;
            result.finishedPid = current.pid;
            result.finishedName = current.name;
        }
        return result;
    }
    stepBack() {
        if (this.history.length === 0)
            return null;
        const snapshot = this.history.pop();
        this.restoreState(snapshot);
        return snapshot;
    }
    loadPage(pcb, page) {
        let frame = this.memoryManager.allocateFrame();
        if (frame === -1)
            return; // Should not happen after eviction
        const entry = pcb.pageTable.getEntry(page);
        entry.setFrameNumber(frame);
        entry.setPresent(true);
        entry.setReferenced(true);
        this.memoryManager.setOwner(frame, new FrameInfo(pcb.pid, page));
        this.arc.onPageLoad(frame, page);
    }
    evictPage(pcb, page, frame) {
        const entry = pcb.pageTable.getEntry(page);
        entry.reset();
        this.memoryManager.freeFrame(frame);
    }
    findFrame(pid, page) {
        const fom = this.memoryManager.getFrameOwnerMap();
        for (const [frame, info] of fom.entries()) {
            if (info.ownerPid === pid && info.virtualPage === page)
                return frame;
        }
        return null;
    }
    terminateProcess(pcb) {
        pcb.state = ProcessState.FINISHED;
        pcb.finishTime = this.clockTick;
        pcb.waitTime = pcb.finishTime - pcb.arrivalTime - pcb.refsExecuted;
        if (pcb.waitTime < 0)
            pcb.waitTime = 0;
        // Free all frames owned by this process
        const fom = this.memoryManager.getFrameOwnerMap();
        const framesToFree = [];
        for (const [frame, info] of fom.entries()) {
            if (info.ownerPid === pcb.pid)
                framesToFree.push(frame);
        }
        for (const f of framesToFree) {
            const page = fom.get(f).virtualPage;
            this.arc.onPageEvict(f, page);
            this.memoryManager.freeFrame(f);
        }
        this.dispatcher.onProcessFinished();
        this.dispatcher.removeProcess(pcb.pid);
        this.finishedProcesses.push(pcb);
    }
    clearAllReferencedBits() {
        for (const pcb of this.pcbTable.getAll()) {
            for (const entry of pcb.pageTable.getAllEntries()) {
                entry.clearReference();
            }
        }
    }
    getPagFaults() { return this.totalPageFaults; }
    getClockTick() { return this.clockTick; }
    getPCBTable() { return this.pcbTable; }
    getMemoryManager() { return this.memoryManager; }
    getDispatcher() { return this.dispatcher; }
    getFinishedProcesses() { return this.finishedProcesses; }
    getGlobalFrameMap() {
        const result = [];
        const fom = this.memoryManager.getFrameOwnerMap();
        for (let f = 0; f < this.totalFrames; f++) {
            const info = fom.get(f);
            if (info)
                result.push({ frame: f, pid: info.ownerPid, page: info.virtualPage });
            else
                result.push({ frame: f, pid: -1, page: -1 });
        }
        return result;
    }
    getFullSnapshot() {
        const dispatcher = this.dispatcher;
        const current = dispatcher.getCurrentProcess();
        return {
            clockTick: this.clockTick,
            totalPageFaults: this.totalPageFaults,
            currentPid: current?.pid ?? null,
            currentProcessName: current?.name ?? null,
            refsInQuantum: dispatcher.getRefsInCurrentQuantum(),
            quantum: this.quantum,
            readyQueue: dispatcher.getReadyQueue().map(p => ({
                pid: p.pid, name: p.name, state: p.state,
                remainingRefs: p.getRemainingRefs(),
                pageFaults: p.pageFaults,
                refsExecuted: p.refsExecuted,
            })),
            frameMap: this.getGlobalFrameMap(),
            processes: this.pcbTable.getAll().map(p => ({
                pid: p.pid,
                name: p.name,
                state: p.state,
                numPages: p.numPages,
                pageFaults: p.pageFaults,
                refsExecuted: p.refsExecuted,
                remainingRefs: p.getRemainingRefs(),
                arrivalTime: p.arrivalTime,
                finishTime: p.finishTime,
                waitTime: p.waitTime,
                currentRefIndex: p.getCurrentRefIndex(),
                allRefs: p.getAllRefs(),
                pageTable: p.pageTable.getAllEntries().map((e, i) => ({
                    page: i,
                    frame: e.getFrameNumber(),
                    present: e.isPresent(),
                    referenced: e.isReferenced(),
                    dirty: e.isDirty(),
                })),
            })),
            finishedProcesses: this.finishedProcesses.map(p => ({
                pid: p.pid,
                name: p.name,
                arrivalTime: p.arrivalTime,
                finishTime: p.finishTime,
                waitTime: p.waitTime,
                pageFaults: p.pageFaults,
                refsExecuted: p.refsExecuted,
            })),
            canStepBack: this.history.length > 0,
        };
    }
    captureState() {
        // Keep last 50 steps
        if (this.history.length >= 50)
            this.history.shift();
        // Deep snapshot
        const snap = {
            pcbs: this.pcbTable.getAll().map(p => p.clone()),
            frameOwner: this.memoryManager.cloneFrameOwner(),
            freeFrames: this.memoryManager.getFreeFrames(),
            currentPid: this.dispatcher.getCurrentProcess()?.pid ?? null,
            pageFaults: this.totalPageFaults,
            clockTick: this.clockTick,
            dispatcherQueue: this.dispatcher.getReadyQueue().map(p => p.pid),
            arcState: this.arc.getState(),
        };
        this.history.push(snap);
    }
    restoreState(snap) {
        // Restore PCB table
        const newPcbTable = new PCBTable();
        const pcbMap = new Map();
        for (const pcb of snap.pcbs) {
            newPcbTable.add(pcb);
            pcbMap.set(pcb.pid, pcb);
        }
        this.pcbTable = newPcbTable;
        // Restore memory
        const mm = new MemoryManager(this.totalFrames);
        snap.frameOwner.forEach((v, k) => mm.setOwner(k, v));
        // Restore free frames
        const occupied = new Set(snap.frameOwner.keys());
        for (let i = 0; i < this.totalFrames; i++) {
            if (!occupied.has(i))
                mm.allocateFrame(); // removes from free list
        }
        // Actually rebuild free frames properly
        mm.freeFrames = snap.freeFrames;
        this.memoryManager = mm;
        // Restore dispatcher
        const newDispatcher = new Dispatcher(this.quantum);
        const dispState = {
            currentPid: snap.currentPid,
            queuePids: snap.dispatcherQueue,
            refsInQuantum: 0,
        };
        newDispatcher.restoreState(dispState, pcbMap);
        this.dispatcher = newDispatcher;
        // Restore ARC
        this.arc.restoreState(snap.arcState);
        this.totalPageFaults = snap.pageFaults;
        this.clockTick = snap.clockTick;
    }
}
