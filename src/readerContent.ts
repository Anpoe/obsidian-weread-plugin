import { requestUrl, RequestUrlParam } from 'obsidian';
import * as CryptoJS from 'crypto-js';

const WEREAD_BASE_URL = 'https://weread.qq.com';

type ReaderHeaders = Record<string, string>;

export type ReaderParagraph = {
	text: string;
	compact: string;
	compactToText: number[];
};

const getReaderIdParts = (id: string): [string, string[]] => {
	if (/^[0-9]*$/.test(id)) {
		const chunks: string[] = [];
		for (let i = 0; i < id.length; i += 9) {
			const chunk = id.slice(i, Math.min(i + 9, id.length));
			chunks.push(parseInt(chunk, 10).toString(16));
		}
		return ['3', chunks];
	}

	let value = '';
	for (let i = 0; i < id.length; i++) {
		value += id.charCodeAt(i).toString(16);
	}
	return ['4', [value]];
};

/** 微信读书网页阅读器使用的 book/chapter ID 编码。 */
export const encodeReaderId = (value: string | number): string => {
	const id = String(value);
	const digest = CryptoJS.MD5(id).toString(CryptoJS.enc.Hex);
	const parts = getReaderIdParts(id);
	let encoded = digest.slice(0, 3) + parts[0] + '2' + digest.slice(-2);

	for (let i = 0; i < parts[1].length; i++) {
		const part = parts[1][i];
		encoded += part.length.toString(16).padStart(2, '0');
		encoded += part;
		if (i < parts[1].length - 1) encoded += 'g';
	}

	if (encoded.length < 20) encoded += digest.slice(0, 20 - encoded.length);
	return encoded + CryptoJS.MD5(encoded).toString(CryptoJS.enc.Hex).slice(0, 3);
};

export const getPcUrl = (bookId: string): string => {
	return `${WEREAD_BASE_URL}/web/reader/${encodeReaderId(bookId)}`;
};

const hashReaderQuery = (value: string): string => {
	let a = 0x15051505;
	let b = a;
	const length = value.length;

	for (let i = length - 1; i > 0; i -= 2) {
		a = 0x7fffffff & (a ^ (value.charCodeAt(i) << ((length - i) % 0x1e)));
		b = 0x7fffffff & (b ^ (value.charCodeAt(i - 1) << (i % 0x1e)));
	}

	return (a + b).toString(16).toLowerCase();
};

const makeReaderBody = (
	bookId: string,
	chapterUid: number,
	psvts: string,
	serverTime: number
): Record<string, string | number> => {
	const body: Record<string, string | number> = {
		b: encodeReaderId(bookId),
		c: encodeReaderId(chapterUid),
		r: Math.pow(parseInt(String(10000 * Math.random()), 10), 2),
		st: 0,
		ct: serverTime,
		ps: psvts,
		pc: encodeReaderId(serverTime),
		sc: 0
	};

	const query = Object.keys(body)
		.sort()
		.map((key) => `${key}=${encodeURIComponent(body[key])}`)
		.join('&');
	body.s = hashReaderQuery(query);
	return body;
};

const verifyReaderResponse = (body: string): string => {
	if (!body || body.length <= 32) return body;
	const rest = body.slice(32);
	const digest = CryptoJS.MD5(rest).toString(CryptoJS.enc.Hex).toUpperCase();
	return body.slice(0, 32) === digest ? rest : '';
};

/** 解开阅读器返回的轻量混淆内容。 */
const decryptReaderResponse = (body: string): string => {
	if (!body || body.length <= 1) return '';
	const value = body.slice(1);
	const length = value.length;
	if (length < 4) return '';

	const indexes =
		length < 11
			? [0, 2]
			: (() => {
				const count = Math.min(4, Math.ceil(length / 10));
				let seed = '';
				for (let i = length - 1; i > length - 1 - count; i--) {
					seed += parseInt(value.charCodeAt(i).toString(2), 4);
				}

				const base = length - count - 2;
				const width = String(base).length;
				const result: number[] = [];
				for (let i = 0; result.length < 10 && i + width < seed.length; i += width) {
					result.push(parseInt(seed.slice(i, i + width), 10) % base);
					result.push(parseInt(seed.slice(i + 1, i + 1 + width), 10) % base);
				}
				return result;
			})();

	const chars = value.split('');
	for (let i = indexes.length - 1; i >= 0; i -= 2) {
		for (let offset = 1; offset >= 0; offset--) {
			const left = indexes[i] + offset;
			const right = indexes[i - 1] + offset;
			[chars[left], chars[right]] = [chars[right], chars[left]];
		}
	}

	// 浏览器端使用 Base64.decode；Node/Electron 的 Buffer 在 Obsidian 中可用。
	return atobUtf8(chars.join(''));
};

const atobUtf8 = (value: string): string => {
	const binary = window.atob(value);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
};

const readerRequest = async (
	url: string,
	method: 'GET' | 'POST',
	headers: ReaderHeaders,
	body?: string
): Promise<string> => {
	const request: RequestUrlParam = {
		url,
		method,
		headers,
		body
	};
	const response = await requestUrl(request);
	return response.text || '';
};

/** 获取阅读器当前书籍版本的内容时间戳。 */
export const fetchReaderTimestamp = async (
	bookId: string,
	headers: ReaderHeaders
): Promise<string | undefined> => {
	const readerUrl = getPcUrl(bookId);
	const pageHeaders = {
		...headers,
		Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
		Referer: `${WEREAD_BASE_URL}/web/book/info?bookId=${bookId}`
	};
	const page = await readerRequest(readerUrl, 'GET', pageHeaders);
	return page.match(/"psvts"\s*:\s*"([^"]+)"/)?.[1];
};

/** 获取单个章节的原始 XHTML。失败时返回 undefined，由调用方保留原摘录。 */
export const fetchReaderChapterContent = async (
	bookId: string,
	chapterUid: number,
	psvts: string,
	headers: ReaderHeaders
): Promise<string | undefined> => {
	const serverTime = Math.floor(Date.now() / 1000);
	const requestHeaders = {
		...headers,
		Accept: 'application/json, text/plain, */*',
		'Content-Type': 'application/json',
		Origin: WEREAD_BASE_URL,
		Referer: getPcUrl(bookId)
	};

	const endpoints = ['e_0', 'e_1', 'e_3'];
	const responses = await Promise.all(
		endpoints.map((endpoint) =>
			readerRequest(
				`${WEREAD_BASE_URL}/web/book/chapter/${endpoint}`,
				'POST',
				requestHeaders,
				JSON.stringify(makeReaderBody(bookId, chapterUid, psvts, serverTime))
			)
		)
	);

	const decoded = decryptReaderResponse(
		responses.map((response) => verifyReaderResponse(response)).join('')
	);
	return decoded.includes('<html') && decoded.includes('<p') ? decoded : undefined;
};

const decodeHtmlEntities = (value: string): string => {
	return value
		.replace(/&nbsp;/gi, ' ')
		.replace(/&lt;/gi, '<')
		.replace(/&gt;/gi, '>')
		.replace(/&amp;/gi, '&')
		.replace(/&quot;/gi, '"')
		.replace(/&#39;/gi, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
};

const textToParagraph = (value: string): ReaderParagraph => {
	const text = value.replace(/\r\n?/g, '\n');
	let compact = '';
	const compactToText: number[] = [];
	for (let i = 0; i < text.length; i++) {
		const char = text[i];
		if (/\s/.test(char) || char === '\u200b' || char === '\ufeff') continue;
		compact += char;
		compactToText.push(i);
	}
	return { text, compact, compactToText };
};

const collectText = (node: Node): string => {
	let result = '';
	for (const child of Array.from(node.childNodes)) {
		if (child.nodeType === 3) {
			result += child.nodeValue || '';
			continue;
		}
		if (child.nodeType !== 1) continue;
		const element = child as Element;
		if (element.tagName.toLowerCase() === 'br') {
			result += '\n';
		} else {
			result += collectText(element);
		}
	}
	return result;
};

const extractParagraphsWithDom = (content: string): ReaderParagraph[] => {
	const parse = (type: DOMParserSupportedType) => new DOMParser().parseFromString(content, type);
	let document = parse('application/xhtml+xml');
	if (document.querySelector('parsererror')) document = parse('text/html');

	const nodes = Array.from(
		document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre')
	);
	return nodes.map((node) => textToParagraph(collectText(node))).filter((item) => item.compact.length > 0);
};

const extractParagraphsWithRegex = (content: string): ReaderParagraph[] => {
	const matches = [...content.matchAll(/<(p|h[1-6]|li|blockquote|pre)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
	return matches
		.map((match) =>
			textToParagraph(
				decodeHtmlEntities(
					match[2]
						.replace(/<br\s*\/?>/gi, '\n')
						.replace(/<[^>]+>/g, '')
				)
			)
		)
		.filter((item) => item.compact.length > 0);
};

export const extractReaderParagraphs = (content: string): ReaderParagraph[] => {
	try {
		if (typeof DOMParser !== 'undefined') {
			const paragraphs = extractParagraphsWithDom(content);
			if (paragraphs.length > 0) return paragraphs;
		}
	} catch (error) {
		console.debug('[weread plugin] 阅读器 XHTML DOM 解析失败，使用兼容解析', error);
	}
	return extractParagraphsWithRegex(content);
};

const compactText = (value: string): string => {
	return value.replace(/[\s\u200b\ufeff]/g, '');
};

/** 只有唯一、完整匹配时才恢复，避免把相似摘录误替换。 */
export const restoreParagraphBreaks = (
	markText: string,
	paragraphs: ReaderParagraph[]
): string | undefined => {
	if (!markText || /\r?\n/.test(markText) || paragraphs.length === 0) return undefined;

	const target = compactText(markText);
	if (!target) return undefined;
	const content = paragraphs.map((paragraph) => paragraph.compact).join('');
	const start = content.indexOf(target);
	if (start < 0 || content.indexOf(target, start + target.length) >= 0) return undefined;

	const end = start + target.length;
	let offset = 0;
	const pieces: string[] = [];
	let crossedParagraph = false;

	for (const paragraph of paragraphs) {
		const paragraphStart = offset;
		const paragraphEnd = offset + paragraph.compact.length;
		offset = paragraphEnd;
		if (paragraphEnd <= start || paragraphStart >= end) continue;

		const localStart = Math.max(0, start - paragraphStart);
		const localEnd = Math.min(paragraph.compact.length, end - paragraphStart);
		const originalStart = paragraph.compactToText[localStart] ?? paragraph.text.length;
		const originalEnd = paragraph.compactToText[localEnd] ?? paragraph.text.length;
		const piece = paragraph.text.slice(originalStart, originalEnd).trim();
		if (piece) pieces.push(piece);
		if (pieces.length > 1) crossedParagraph = true;
	}

	if (!crossedParagraph) return undefined;
	const restored = pieces.join('\n');
	return compactText(restored) === target ? restored : undefined;
};
