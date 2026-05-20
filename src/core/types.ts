// ─── Enums ────────────────────────────────────────────────────────────────────

export enum ProcessState {
  READY = "READY",
  RUNNING = "RUNNING",
  FINISHED = "FINISHED",
  DISCARDED = "DISCARDED",
}

// ─── PageTableEntry ───────────────────────────────────────────────────────────

export class PageTableEntry {
  private frameNumber: number = -1;
  private flags: number = 0; // bit0=present, bit1=referenced, bit2=dirty, bits3-4=protection

  getFrameNumber(): number { return this.frameNumber; }
  setFrameNumber(f: number): void { this.frameNumber = f; }

  isPresent(): boolean { return (this.flags & 0b00001) !== 0; }
  setPresent(v: boolean): void { v ? (this.flags |= 0b00001) : (this.flags &= ~0b00001); }

  isReferenced(): boolean { return (this.flags & 0b00010) !== 0; }
  setReferenced(v: boolean): void { v ? (this.flags |= 0b00010) : (this.flags &= ~0b00010); }
  clearReference(): void { this.flags &= ~0b00010; }

  isDirty(): boolean { return (this.flags & 0b00100) !== 0; }
  setDirty(v: boolean): void { v ? (this.flags |= 0b00100) : (this.flags &= ~0b00100); }

  getProtection(): number { return (this.flags >> 3) & 0b11; }
  setProtection(p: number): void { this.flags = (this.flags & ~(0b11 << 3)) | ((p & 0b11) << 3); }

  reset(): void { this.frameNumber = -1; this.flags = 0; }

  clone(): PageTableEntry {
    const e = new PageTableEntry();
    e.frameNumber = this.frameNumber;
    e.flags = this.flags;
    return e;
  }
}

// ─── PageTable ────────────────────────────────────────────────────────────────

export class PageTable {
  private entries: PageTableEntry[];
  private size: number;

  constructor(size: number) {
    this.size = size;
    this.entries = Array.from({ length: size }, () => new PageTableEntry());
  }

  getEntry(pageNum: number): PageTableEntry { return this.entries[pageNum]; }
  setEntry(pageNum: number, entry: PageTableEntry): void { this.entries[pageNum] = entry; }
  getFreeSlots(): number { return this.entries.filter(e => !e.isPresent()).length; }
  getAllEntries(): PageTableEntry[] { return this.entries; }
  getSize(): number { return this.size; }

  clone(): PageTable {
    const pt = new PageTable(this.size);
    for (let i = 0; i < this.size; i++) pt.entries[i] = this.entries[i].clone();
    return pt;
  }
}

// ─── FrameInfo ────────────────────────────────────────────────────────────────

export class FrameInfo {
  constructor(public ownerPid: number, public virtualPage: number) {}
  clone(): FrameInfo { return new FrameInfo(this.ownerPid, this.virtualPage); }
}

// ─── PCB ──────────────────────────────────────────────────────────────────────

export class PCB {
  pid: number;
  name: string;
  numPages: number;
  state: ProcessState;
  pageTable: PageTable;
  private referenceList: number[];
  private refIndex: number = 0;
  refsExecuted: number = 0;

  // Stats
  arrivalTime: number = 0;
  finishTime: number = 0;
  waitTime: number = 0;
  pageFaults: number = 0;
  originNodeId?: string; // for distributed part

  constructor(pid: number, name: string, numPages: number, refs: number[], originNodeId?: string) {
    this.pid = pid;
    this.name = name;
    this.numPages = numPages;
    this.state = ProcessState.READY;
    this.pageTable = new PageTable(numPages);
    this.referenceList = [...refs];
    this.originNodeId = originNodeId;
  }

  getNextRef(): number { return this.referenceList[this.refIndex]; }
  peekRef(offset: number = 0): number | undefined { return this.referenceList[this.refIndex + offset]; }
  advanceRef(): void { this.refIndex++; this.refsExecuted++; }
  hasRefs(): boolean { return this.refIndex < this.referenceList.length; }
  getRemainingRefs(): number { return this.referenceList.length - this.refIndex; }
  getAllRefs(): number[] { return this.referenceList; }
  getCurrentRefIndex(): number { return this.refIndex; }

  clone(): PCB {
    const c = new PCB(this.pid, this.name, this.numPages, this.getAllRefs(), this.originNodeId);
    c.state = this.state;
    c.pageTable = this.pageTable.clone();
    c.refIndex = this.refIndex; // We use private field trick via cast
    (c as any).refIndex = this.refIndex;
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
  private processes: Map<number, PCB> = new Map();

  add(pcb: PCB): void { this.processes.set(pcb.pid, pcb); }
  remove(pid: number): void { this.processes.delete(pid); }
  get(pid: number): PCB | undefined { return this.processes.get(pid); }
  getAll(): PCB[] { return Array.from(this.processes.values()); }
  getByState(s: ProcessState): PCB[] { return this.getAll().filter(p => p.state === s); }
  has(pid: number): boolean { return this.processes.has(pid); }
}

// ─── MemoryManager ────────────────────────────────────────────────────────────

export class MemoryManager {
  totalFrames: number;
  private freeFrames: number[];
  private frameOwner: Map<number, FrameInfo> = new Map();

  constructor(totalFrames: number) {
    this.totalFrames = totalFrames;
    this.freeFrames = Array.from({ length: totalFrames }, (_, i) => i);
  }

  allocateFrame(): number {
    if (this.freeFrames.length === 0) return -1;
    return this.freeFrames.shift()!;
  }

  freeFrame(frame: number): void {
    this.frameOwner.delete(frame);
    this.freeFrames.push(frame);
  }

  isFull(): boolean { return this.freeFrames.length === 0; }
  getOwner(frame: number): FrameInfo | undefined { return this.frameOwner.get(frame); }
  setOwner(frame: number, info: FrameInfo): void { this.frameOwner.set(frame, info); }
  getFrameOwnerMap(): Map<number, FrameInfo> { return this.frameOwner; }
  getFreeFrames(): number[] { return [...this.freeFrames]; }

  cloneFrameOwner(): Map<number, FrameInfo> {
    const m = new Map<number, FrameInfo>();
    this.frameOwner.forEach((v, k) => m.set(k, v.clone()));
    return m;
  }
}

// ─── SimStat (snapshot for undo) ──────────────────────────────────────────────

export interface SimStat {
  pcbs: PCB[];
  frameOwner: Map<number, FrameInfo>;
  freeFrames: number[];
  currentPid: number | null;
  pageFaults: number;
  clockTick: number;
  dispatcherQueue: number[]; // pids
  arcState: ARCState;
}

export interface ARCState {
  T1: number[];
  T2: number[];
  B1: number[];
  B2: number[];
  p: number;
}

// ─── Step result ──────────────────────────────────────────────────────────────

export interface StepResult {
  pageFault: boolean;
  faultPage?: number;
  evictedFrame?: number;
  evictedPid?: number;
  evictedPage?: number;
  processFinished?: boolean;
  finishedPid?: number;
  finishedName?: string;
  noProcesses?: boolean;
  ref?: number;
  currentPid?: number;
  quantumExpired?: boolean;
  processDiscarded?: boolean;
}
