// ─── Enums ────────────────────────────────────────────────────────────────────
export var ProcessState;
(function (ProcessState) {
    ProcessState["READY"] = "READY";
    ProcessState["RUNNING"] = "RUNNING";
    ProcessState["FINISHED"] = "FINISHED";
    ProcessState["DISCARDED"] = "DISCARDED";
})(ProcessState || (ProcessState = {}));
// ─── PageTableEntry ───────────────────────────────────────────────────────────
export class PageTableEntry {
    constructor() {
        this.frameNumber = -1;
        this.flags = 0; // bit0=present, bit1=referenced, bit2=dirty, bits3-4=protection
    }
    getFrameNumber() { return this.frameNumber; }
    setFrameNumber(f) { this.frameNumber = f; }
    isPresent() { return (this.flags & 0b00001) !== 0; }
    setPresent(v) { v ? (this.flags |= 0b00001) : (this.flags &= ~0b00001); }
    isReferenced() { return (this.flags & 0b00010) !== 0; }
    setReferenced(v) { v ? (this.flags |= 0b00010) : (this.flags &= ~0b00010); }
    clearReference() { this.flags &= ~0b00010; }
    isDirty() { return (this.flags & 0b00100) !== 0; }
    setDirty(v) { v ? (this.flags |= 0b00100) : (this.flags &= ~0b00100); }
    getProtection() { return (this.flags >> 3) & 0b11; }
    setProtection(p) { this.flags = (this.flags & ~(0b11 << 3)) | ((p & 0b11) << 3); }
    reset() { this.frameNumber = -1; this.flags = 0; }
    clone() {
        const e = new PageTableEntry();
        e.frameNumber = this.frameNumber;
        e.flags = this.flags;
        return e;
    }
}
// ─── PageTable ────────────────────────────────────────────────────────────────
export class PageTable {
    constructor(size) {
        this.size = size;
        this.entries = Array.from({ length: size }, () => new PageTableEntry());
    }
    getEntry(pageNum) { return this.entries[pageNum]; }
    setEntry(pageNum, entry) { this.entries[pageNum] = entry; }
    getFreeSlots() { return this.entries.filter(e => !e.isPresent()).length; }
    getAllEntries() { return this.entries; }
    getSize() { return this.size; }
    clone() {
        const pt = new PageTable(this.size);
        for (let i = 0; i < this.size; i++)
            pt.entries[i] = this.entries[i].clone();
        return pt;
    }
}
// ─── FrameInfo ────────────────────────────────────────────────────────────────
export class FrameInfo {
    constructor(ownerPid, virtualPage) {
        this.ownerPid = ownerPid;
        this.virtualPage = virtualPage;
    }
    clone() { return new FrameInfo(this.ownerPid, this.virtualPage); }
}
// ─── PCB ──────────────────────────────────────────────────────────────────────
export class PCB {
    constructor(pid, name, numPages, refs, originNodeId) {
        this.refIndex = 0;
        this.refsExecuted = 0;
        // Stats
        this.arrivalTime = 0;
        this.finishTime = 0;
        this.waitTime = 0;
        this.pageFaults = 0;
        this.pid = pid;
        this.name = name;
        this.numPages = numPages;
        this.state = ProcessState.READY;
        this.pageTable = new PageTable(numPages);
        this.referenceList = [...refs];
        this.originNodeId = originNodeId;
    }
    getNextRef() { return this.referenceList[this.refIndex]; }
    peekRef(offset = 0) { return this.referenceList[this.refIndex + offset]; }
    advanceRef() { this.refIndex++; this.refsExecuted++; }
    hasRefs() { return this.refIndex < this.referenceList.length; }
    getRemainingRefs() { return this.referenceList.length - this.refIndex; }
    getAllRefs() { return this.referenceList; }
    getCurrentRefIndex() { return this.refIndex; }
    clone() {
        const c = new PCB(this.pid, this.name, this.numPages, this.getAllRefs(), this.originNodeId);
        c.state = this.state;
        c.pageTable = this.pageTable.clone();
        c.refIndex = this.refIndex; // We use private field trick via cast
        c.refIndex = this.refIndex;
        c.refsExecuted = this.refsExecuted;
        c.arrivalTime = this.arrivalTime;
        c.finishTime = this.finishTime;
        c.waitTime = this.waitTime;
        c.pageFaults = this.pageFaults;
        return c;
    }
}
// ─── PCBTable ─────────────────────────────────────────────────────────────────
export class PCBTable {
    constructor() {
        this.processes = new Map();
    }
    add(pcb) { this.processes.set(pcb.pid, pcb); }
    remove(pid) { this.processes.delete(pid); }
    get(pid) { return this.processes.get(pid); }
    getAll() { return Array.from(this.processes.values()); }
    getByState(s) { return this.getAll().filter(p => p.state === s); }
    has(pid) { return this.processes.has(pid); }
}
// ─── MemoryManager ────────────────────────────────────────────────────────────
export class MemoryManager {
    constructor(totalFrames) {
        this.frameOwner = new Map();
        this.totalFrames = totalFrames;
        this.freeFrames = Array.from({ length: totalFrames }, (_, i) => i);
    }
    allocateFrame() {
        if (this.freeFrames.length === 0)
            return -1;
        return this.freeFrames.shift();
    }
    freeFrame(frame) {
        this.frameOwner.delete(frame);
        this.freeFrames.push(frame);
    }
    isFull() { return this.freeFrames.length === 0; }
    getOwner(frame) { return this.frameOwner.get(frame); }
    setOwner(frame, info) { this.frameOwner.set(frame, info); }
    getFrameOwnerMap() { return this.frameOwner; }
    getFreeFrames() { return [...this.freeFrames]; }
    cloneFrameOwner() {
        const m = new Map();
        this.frameOwner.forEach((v, k) => m.set(k, v.clone()));
        return m;
    }
}
