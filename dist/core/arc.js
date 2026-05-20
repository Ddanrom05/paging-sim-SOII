/**
 * ARC (Adaptive Replacement Cache) Page Replacement Algorithm
 *
 * Maintains 4 lists:
 *   T1 – recently used once (single-access pages in cache)
 *   T2 – recently used more than once (multi-access pages in cache)
 *   B1 – ghost entries evicted from T1 (not in cache)
 *   B2 – ghost entries evicted from T2 (not in cache)
 *   p  – target size for T1
 */
export class ARCAlgorithm {
    constructor(capacity) {
        this.T1 = []; // frame numbers recently used once
        this.T2 = []; // frame numbers recently used >once
        this.B1 = []; // ghost list for T1 (virtual pages)
        this.B2 = []; // ghost list for T2 (virtual pages)
        this.p = 0; // target T1 size
        this.c = capacity;
    }
    // Called when a page already in cache is accessed
    onPageAccess(frame) {
        // If in T1, promote to T2
        const t1Idx = this.T1.indexOf(frame);
        if (t1Idx !== -1) {
            this.T1.splice(t1Idx, 1);
            this.T2.push(frame); // MRU end of T2
            return;
        }
        // If in T2, move to MRU end
        const t2Idx = this.T2.indexOf(frame);
        if (t2Idx !== -1) {
            this.T2.splice(t2Idx, 1);
            this.T2.push(frame);
        }
    }
    // Called when a new page is loaded into a frame
    onPageLoad(frame, virtualPage) {
        // Check ghost lists
        if (this.B1.includes(virtualPage)) {
            // Hit in B1: increase p
            this.adaptP(true);
            this.B1.splice(this.B1.indexOf(virtualPage), 1);
        }
        else if (this.B2.includes(virtualPage)) {
            // Hit in B2: decrease p
            this.adaptP(false);
            this.B2.splice(this.B2.indexOf(virtualPage), 1);
        }
        // Add to T1 (first access)
        this.T1.push(frame);
    }
    // Called when a page is evicted from cache
    onPageEvict(frame, virtualPage) {
        const t1Idx = this.T1.indexOf(frame);
        if (t1Idx !== -1) {
            this.T1.splice(t1Idx, 1);
            // Add virtual page to B1 ghost list
            this.B1.push(virtualPage);
            // Keep ghost lists bounded
            if (this.B1.length > this.c)
                this.B1.shift();
            return;
        }
        const t2Idx = this.T2.indexOf(frame);
        if (t2Idx !== -1) {
            this.T2.splice(t2Idx, 1);
            // Add virtual page to B2 ghost list
            this.B2.push(virtualPage);
            if (this.B2.length > this.c)
                this.B2.shift();
        }
    }
    adaptP(hitInB1) {
        if (hitInB1) {
            const delta = this.B2.length >= this.B1.length ? 1 : Math.floor(this.B2.length / Math.max(this.B1.length, 1));
            this.p = Math.min(this.p + Math.max(delta, 1), this.c);
        }
        else {
            const delta = this.B1.length >= this.B2.length ? 1 : Math.floor(this.B1.length / Math.max(this.B2.length, 1));
            this.p = Math.max(this.p - Math.max(delta, 1), 0);
        }
    }
    replace() {
        // Decide whether to evict from T1 or T2
        if (this.T1.length > 0 && (this.T1.length > this.p || this.T2.length === 0)) {
            return this.T1[0]; // LRU of T1
        }
        if (this.T2.length > 0) {
            return this.T2[0]; // LRU of T2
        }
        if (this.T1.length > 0) {
            return this.T1[0];
        }
        return -1;
    }
    inCache(frame) {
        return this.T1.includes(frame) || this.T2.includes(frame);
    }
    selectVictim(frameOwner, _pcbTable) {
        const victimFrame = this.replace();
        if (victimFrame === -1) {
            // Fallback: pick any occupied frame
            const frames = Array.from(frameOwner.keys());
            if (frames.length === 0)
                return null;
            const f = frames[0];
            return frameOwner.get(f) ?? null;
        }
        return frameOwner.get(victimFrame) ?? null;
    }
    getState() {
        return {
            T1: [...this.T1],
            T2: [...this.T2],
            B1: [...this.B1],
            B2: [...this.B2],
            p: this.p,
        };
    }
    restoreState(state) {
        this.T1 = [...state.T1];
        this.T2 = [...state.T2];
        this.B1 = [...state.B1];
        this.B2 = [...state.B2];
        this.p = state.p;
    }
}
