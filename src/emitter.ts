import { Actor, log } from 'apify';

/**
 * Buffers dataset rows and pushes/charges them in batches.
 * One pushData + one Actor.charge({count}) per event per batch instead of 2 API calls per row,
 * which cuts run time (and platform cost) on large inputs by ~10x.
 * Rows are always saved before they are charged; rows with event=null (errors) are never charged.
 */
export class Emitter {
    private buf: { row: object; event: string | null }[] = [];
    private ppe: boolean | null = null;
    limitReached = false;

    constructor(private readonly batchSize = 100) {}

    async emit(row: object, event: string | null): Promise<void> {
        this.buf.push({ row, event });
        if (this.buf.length >= this.batchSize) await this.flush();
    }

    async flush(): Promise<void> {
        if (!this.buf.length) return;
        const batch = this.buf;
        this.buf = [];
        await Actor.pushData(batch.map((b) => b.row));
        if (!this.isPpe()) return;
        const counts = new Map<string, number>();
        for (const b of batch) if (b.event) counts.set(b.event, (counts.get(b.event) ?? 0) + 1);
        for (const [eventName, count] of counts) {
            try {
                const res = await Actor.charge({ eventName, count });
                if (res.eventChargeLimitReached) {
                    log.warning(`Charge limit reached for ${eventName}`);
                    this.limitReached = true;
                }
            } catch (e) {
                log.debug(`Actor.charge failed for ${eventName}: ${e instanceof Error ? e.message : String(e)}`);
            }
        }
    }

    private isPpe(): boolean {
        if (this.ppe === null) {
            try {
                this.ppe = Actor.getChargingManager().getPricingInfo().isPayPerEvent;
            } catch {
                this.ppe = false;
            }
        }
        return this.ppe;
    }
}
