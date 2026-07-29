import { describe, expect, it } from "vitest";
import { isSpamEmail } from "./ai";

// Fake Workers AI binding: records the input it was handed and replies with a
// canned verdict (or throws, to exercise the fail-open path).
function fakeAi(verdict: string | (() => never)) {
	const runs: Array<Record<string, any>> = [];
	const ai = {
		async run(_model: string, input: Record<string, any>) {
			runs.push(input);
			if (typeof verdict === "function") verdict();
			return { response: verdict };
		},
	} as unknown as Ai;
	return { ai, runs };
}

const EMAIL = {
	sender: "promo@evil.example",
	recipient: "me@myinbox.example",
	subject: "You won",
	body: "Claim your prize now.",
};

function userContent(runs: Array<Record<string, any>>): string {
	return runs[0].messages.find((m: { role: string }) => m.role === "user").content;
}

describe("isSpamEmail", () => {
	it("returns true for a SPAM verdict", async () => {
		const { ai } = fakeAi("SPAM");
		expect(await isSpamEmail(ai, EMAIL)).toBe(true);
	});

	it("returns false for a HAM verdict", async () => {
		const { ai } = fakeAi("HAM");
		expect(await isSpamEmail(ai, EMAIL)).toBe(false);
	});

	it("tolerates trailing punctuation and whitespace", async () => {
		const { ai } = fakeAi("  SPAM.\n");
		expect(await isSpamEmail(ai, EMAIL)).toBe(true);
	});

	it("reads 'NOT SPAM' as not spam", async () => {
		const { ai } = fakeAi("NOT SPAM");
		expect(await isSpamEmail(ai, EMAIL)).toBe(false);
	});

	it("returns false for an empty or unparseable response", async () => {
		expect(await isSpamEmail(fakeAi("").ai, EMAIL)).toBe(false);
		expect(await isSpamEmail(fakeAi("I am not sure").ai, EMAIL)).toBe(false);
	});

	it("fails open when the model call throws", async () => {
		const { ai } = fakeAi(() => {
			throw new Error("AI unavailable");
		});
		expect(await isSpamEmail(ai, EMAIL)).toBe(false);
	});

	it("strips HTML and truncates a long body before prompting", async () => {
		const { ai, runs } = fakeAi("HAM");
		const long = "x".repeat(5000);
		await isSpamEmail(ai, { ...EMAIL, body: `<p>${long}</p>` });

		const content = userContent(runs);
		expect(content).not.toContain("<p>");
		// The body run — not the stray "x" in the sender's example.com address.
		expect(content.match(/x{100,}/)![0]).toHaveLength(2000);
	});

	it("still classifies an email with an empty body", async () => {
		const { ai, runs } = fakeAi("SPAM");
		expect(await isSpamEmail(ai, { ...EMAIL, body: null })).toBe(true);
		expect(userContent(runs)).toContain("(empty body)");
	});

	it("labels an absent recipient as hidden rather than skipping the call", async () => {
		const { ai, runs } = fakeAi("HAM");
		// A hidden recipient is a signal for the model to weigh, not a verdict.
		expect(await isSpamEmail(ai, { ...EMAIL, recipient: "" })).toBe(false);
		expect(userContent(runs)).toContain("To: (hidden)");
	});
});
