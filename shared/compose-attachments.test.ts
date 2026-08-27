// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { describe, expect, it } from "vitest";
import {
	base64ByteLength,
	extractInlineImages,
	imageExtensionForMime,
	inlineImageBytes,
} from "./compose-attachments";

// 1x1 transparent GIF — small enough to inline, real enough to decode.
const GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const PNG = "iVBORw0KGgoAAAANSUhEUg==";

function ids() {
	let n = 0;
	return () => `cid-${++n}`;
}

describe("base64ByteLength", () => {
	it("matches the decoded length", () => {
		expect(base64ByteLength(GIF)).toBe(atob(GIF).length);
		expect(base64ByteLength(PNG)).toBe(atob(PNG).length);
	});

	it("ignores whitespace and treats too-short input as empty", () => {
		expect(base64ByteLength(`${GIF.slice(0, 8)}\n${GIF.slice(8)}`)).toBe(
			atob(GIF).length,
		);
		expect(base64ByteLength("")).toBe(0);
		expect(base64ByteLength("AA")).toBe(0);
	});
});

describe("extractInlineImages", () => {
	it("replaces a data URL with a cid reference and returns the attachment", () => {
		const html = `<p>hi</p><img src="data:image/gif;base64,${GIF}">`;
		const result = extractInlineImages(html, ids());

		expect(result.html).toBe('<p>hi</p><img src="cid:cid-1">');
		expect(result.attachments).toEqual([
			{
				content: GIF,
				filename: "image-1.gif",
				type: "image/gif",
				disposition: "inline",
				contentId: "cid-1",
			},
		]);
	});

	it("reuses one attachment when the same image appears twice", () => {
		const img = `<img src="data:image/gif;base64,${GIF}">`;
		const result = extractInlineImages(`${img}${img}`, ids());

		expect(result.attachments).toHaveLength(1);
		expect(result.html).toBe(
			'<img src="cid:cid-1"><img src="cid:cid-1">',
		);
	});

	it("gives distinct images distinct content ids", () => {
		const html = `<img src="data:image/gif;base64,${GIF}"><img src="data:image/png;base64,${PNG}">`;
		const result = extractInlineImages(html, ids());

		expect(result.attachments.map((a) => a.contentId)).toEqual([
			"cid-1",
			"cid-2",
		]);
		expect(result.attachments.map((a) => a.filename)).toEqual([
			"image-1.gif",
			"image-2.png",
		]);
	});

	it("leaves non-image data URLs and remote images alone", () => {
		const html =
			'<img src="https://example.com/a.png"><a href="data:text/plain;base64,aGk=">x</a>';
		const result = extractInlineImages(html, ids());

		expect(result.html).toBe(html);
		expect(result.attachments).toEqual([]);
	});

	it("is a no-op on an empty body", () => {
		expect(extractInlineImages("", ids())).toEqual({
			html: "",
			attachments: [],
		});
	});
});

describe("inlineImageBytes", () => {
	it("counts each distinct image once", () => {
		const img = `<img src="data:image/gif;base64,${GIF}">`;
		expect(inlineImageBytes(`${img}${img}`)).toBe(atob(GIF).length);
		expect(
			inlineImageBytes(`${img}<img src="data:image/png;base64,${PNG}">`),
		).toBe(atob(GIF).length + atob(PNG).length);
	});

	it("returns zero when the body has no inline images", () => {
		expect(inlineImageBytes("<p>plain</p>")).toBe(0);
		expect(inlineImageBytes("")).toBe(0);
	});
});

describe("imageExtensionForMime", () => {
	it("maps known types and falls back to the subtype", () => {
		expect(imageExtensionForMime("image/jpeg")).toBe("jpg");
		expect(imageExtensionForMime("IMAGE/PNG")).toBe("png");
		expect(imageExtensionForMime("image/svg+xml")).toBe("svg");
		expect(imageExtensionForMime("image/x-quirky")).toBe("xquirky");
		expect(imageExtensionForMime("image/+++")).toBe("bin");
	});
});
