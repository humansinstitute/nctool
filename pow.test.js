import { mineEventPow } from "./pow.js";

jest.setTimeout(30000);

const baseEvent = {
    kind: 1,
    content: "test-content",
    tags: [],
    created_at: 1,
    pubkey: "00".repeat(32)
};

function makeEvt(raw = baseEvent) {
    return { rawEvent: () => ({ ...raw }) };
}

describe("mineEventPow", () => {
    test("difficulty 0 adds exactly one nonce tag", async () => {
        const evt = makeEvt();
        const mined = await mineEventPow(evt, 0);
        expect(Array.isArray(mined.tags)).toBe(true);
        expect(mined.tags.length).toBe(1);
        const [key, nonce, diff] = mined.tags[0];
        expect(key).toBe("nonce");
        expect(nonce).toBe("0");
        expect(diff).toBe("0");
    });

    test("difficulty 4 produces an ID starting with one '0' hex", async () => {
        const evt = makeEvt();
        const mined = await mineEventPow(evt, 4);
        expect(mined.id[0]).toBe("0");
    });

    test("difficulty 8 produces an ID starting with two '0' hex characters", async () => {
        const evt = makeEvt();
        const mined = await mineEventPow(evt, 8);
        expect(mined.id.slice(0, 2)).toBe("00");
    });
});
