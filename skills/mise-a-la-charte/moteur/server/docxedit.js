
const fs = require("fs");
const AdmZip = require("adm-zip");

const RUN_T = /<w:t(?: [^>]*)?>([\s\S]*?)<\/w:t>/g;
const CHECKBOX = /<w:checkBox>[\s\S]*?<\/w:checkBox>/g;
const CHECKED_EL = /<w:checked\b[^>]*\/>/;
function isChecked(xml) {
	const m = /<w:checked\b([^>]*)\/>/.exec(xml);
	if (!m) return false;
	const val = /w:val="([^"]*)"/.exec(m[1]);
	return val ? !/^(0|false|off)$/i.test(val[1]) : true;
}

const corpsWord = (zip) => zip.readAsText("word/document.xml").replace(/<w:p\b([^>]*?)\/>/g, "<w:p$1></w:p>");

const decode = (s) =>
	String(s)
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

const encodeXml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const encodeHtml = (s) =>
	String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const TOKEN =
	/<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc\b[^>]*>|<\/w:tc>|<w:p\b[^>]*>|<\/w:p>|<w:checkBox>[\s\S]*?<\/w:checkBox>|<w:t(?: [^>]*)?>[\s\S]*?<\/w:t>|<w:br\/>|<w:tab\/>/g;

function paragraphes(xml) {
	const out = [];
	let cur = null;
	let m;
	TOKEN.lastIndex = 0;
	while ((m = TOKEN.exec(xml))) {
		const tok = m[0];
		if (tok.startsWith("<w:p")) {
			cur = { idx: out.length, fin: -1, runs: 0 };
			out.push(cur);
		} else if (tok === "</w:p>") {
			if (cur) cur.fin = m.index;
			cur = null;
		} else if (tok.startsWith("<w:t") && cur) cur.runs++;
	}
	return out;
}

const paragraphesVides = (xml) =>
	new Set(
		paragraphes(xml)
			.filter((p) => !p.runs)
			.map((p) => p.idx),
	);

function toEditableHtml(buffer) {
	const zip = new AdmZip(buffer);
	const xml = corpsWord(zip);
	const vides = paragraphesVides(xml);
	let html = "";
	let runIdx = 0;
	let ckIdx = 0;
	let pIdx = -1;
	let m;
	TOKEN.lastIndex = 0;
	while ((m = TOKEN.exec(xml))) {
		const tok = m[0];
		if (tok.startsWith("<w:p")) {
			pIdx++;
			html += '<div class="dx-p">';
			if (vides.has(pIdx)) html += `<span class="dx-t dx-new" data-p="${pIdx}" contenteditable="true"></span>`;
			continue;
		}
		if (tok.startsWith("<w:tbl")) html += '<table class="dx-tbl"><tbody>';
		else if (tok === "</w:tbl>") html += "</tbody></table>";
		else if (tok.startsWith("<w:tr")) html += "<tr>";
		else if (tok === "</w:tr>") html += "</tr>";
		else if (tok.startsWith("<w:tc")) html += '<td class="dx-td">';
		else if (tok === "</w:tc>") html += "</td>";
		else if (tok === "</w:p>") html += "</div>";
		else if (tok === "<w:br/>") html += "<br>";
		else if (tok === "<w:tab/>") html += '<span class="dx-tab"></span>';
		else if (tok.startsWith("<w:checkBox")) {
			const on = isChecked(tok) ? "1" : "0";
			html += `<span class="dx-ck" data-c="${ckIdx}" data-on="${on}" role="checkbox" tabindex="0" aria-checked="${on === "1"}"></span>`;
			ckIdx++;
		} else if (tok.startsWith("<w:t")) {
			const inner = tok.replace(RUN_T, "$1");
			const text = decode(inner);
			html += `<span class="dx-t" data-r="${runIdx}" contenteditable="true">${encodeHtml(text)}</span>`;
			runIdx++;
		}
	}
	return { html, runs: runIdx, checks: ckIdx };
}

function applyEdits(buffer, edits) {
	const runs = (edits && edits.runs) || {};
	const checks = (edits && edits.checks) || {};
	const news = (edits && edits.news) || {};
	const zip = new AdmZip(buffer);
	let xml = corpsWord(zip);

	let i = 0;
	xml = xml.replace(/(<w:t)((?: [^>]*)?)(>)([\s\S]*?)(<\/w:t>)/g, (full, open, attrs, gt, txt, close) => {
		const key = String(i++);
		if (!Object.prototype.hasOwnProperty.call(runs, key)) return full;
		const val = encodeXml(runs[key]);
		const needSpace = /^\s|\s$/.test(runs[key]);
		const attrsOut = needSpace && !/xml:space=/.test(attrs) ? attrs + ' xml:space="preserve"' : attrs;
		return open + attrsOut + gt + val + close;
	});

	let j = 0;
	xml = xml.replace(CHECKBOX, (m) => {
		const key = String(j++);
		if (!Object.prototype.hasOwnProperty.call(checks, key)) return m;
		const want = !!checks[key];
		const isOn = isChecked(m);
		if (want === isOn) return m;
		if (want) {
			return CHECKED_EL.test(m)
				? m.replace(CHECKED_EL, "<w:checked/>")
				: m.replace("</w:checkBox>", "<w:checked/></w:checkBox>");
		}
		return m.replace(CHECKED_EL, "");
	});

	const aInserer = paragraphes(xml)
		.filter((p) => Object.prototype.hasOwnProperty.call(news, String(p.idx)) && news[String(p.idx)])
		.sort((a, b) => b.fin - a.fin);
	for (const p of aInserer) {
		const run = `<w:r><w:t xml:space="preserve">${encodeXml(news[String(p.idx)])}</w:t></w:r>`;
		xml = xml.slice(0, p.fin) + run + xml.slice(p.fin);
	}

	zip.updateFile("word/document.xml", Buffer.from(xml, "utf8"));
	return zip.toBuffer();
}

function toPlainText(buf) {
	let html;
	try {
		html = toEditableHtml(buf).html || "";
	} catch {
		return "";
	}
	return html
		.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
		.replace(/<br\s*\/?>/gi, "\n")
		.replace(/<[^>]+>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

module.exports = { toEditableHtml, applyEdits, toPlainText, paragraphes, corpsWord };
