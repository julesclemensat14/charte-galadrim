const fs = require("fs");
const path = require("path");
const {
	Document,
	Packer,
	Paragraph,
	TextRun,
	ExternalHyperlink,
	InternalHyperlink,
	Bookmark,
	Table,
	TableRow,
	TableCell,
	WidthType,
	BorderStyle,
	AlignmentType,
	Header,
	Footer,
	ImageRun,
	PageNumber,
	PageBreak,
	TableLayoutType,
	HeightRule,
	TextDirection,
	VerticalAlign,
	TableOfContents,
	HeadingLevel,
	PageOrientation,
} = require("docx");


const H1 = "2F5496";
const H2 = "4472C4";
const ENCRE = "000000";
const GRIS = "666666";
const LIEN = "1F3864";
const ENTETE = "D9E2F3";
const ZEBRE = "F2F6FC";
const FILET = "A6A6A6";
const FONT = "Calibri";

const HP = (pt) => Math.round(pt * 2);
const noBorder = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const CONTENT_DXA = 9600;

const IMG_DIR = path.join(__dirname, "../public/img");
const readLogo = (f) => {
	try {
		return fs.readFileSync(path.join(IMG_DIR, f));
	} catch {
		return null;
	}
};
const LOGO_SOMBRE = { data: readLogo("galadrim.png"), ratio: 640 / 112 };

const logoRun = (logo, width) =>
	logo.data
		? new ImageRun({
				type: "png",
				data: logo.data,
				transformation: { width, height: Math.round(width / logo.ratio) },
			})
		: null;

const numeroDeTitre = (text) => {
	const m = String(text || "").match(/^\s*(\d+(?:\.\d+)*)\.?(?=\s|$)/);
	return m ? m[1] : null;
};

const ancreDe = (num) => `sec_${String(num).replace(/\./g, "_")}`;

let ancresConnues = new Set();
let ancresPosees = new Set();

function runs(text, opts = {}) {
	const base = { font: FONT, size: opts.size || HP(11), color: opts.color || ENCRE, ...opts };
	const out = [];
	const re =
		/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(\[À COMPLÉTER[^\]]*\])|\*\*(.+?)\*\*|`(.+?)`|_\*\*(.+?)\*\*_|\*(.+?)\*|((?:[Cc]f\.|[Vv]oir|[Pp]artie|[Ss]ection|[Cc]hapitre|§)\s*(?:§\s*)?)(\d+(?:\.\d+)+)/g;
	let last = 0;
	let m;
	const push = (t, extra) => t && out.push(new TextRun({ ...base, text: t, ...extra }));
	while ((m = re.exec(text))) {
		push(text.slice(last, m.index));
		if (m[2] !== undefined) {
			out.push(
				new ExternalHyperlink({
					link: m[2],
					children: runs(m[1], { ...opts, color: LIEN, underline: {} }),
				}),
			);
		} else if (m[3]) push(m[3], { bold: true, highlight: "yellow" });
		else if (m[4] !== undefined) push(m[4], { bold: true });
		else if (m[5] !== undefined) push(m[5], { font: "Consolas", color: H2 });
		else if (m[6] !== undefined) push(m[6], { bold: true, italics: true });
		else if (m[7] !== undefined) push(m[7], { italics: true });
		else if (m[9] !== undefined) {
			push(m[8]);
			const ancre = ancreDe(m[9]);
			if (ancresConnues.has(ancre))
				out.push(
					new InternalHyperlink({ anchor: ancre, children: runs(m[9], { ...opts, color: LIEN, underline: {} }) }),
				);
			else push(m[9]);
		}
		last = re.lastIndex;
	}
	push(text.slice(last));
	return out.length ? out : [new TextRun({ ...base, text: "" })];
}

function heading(text, niveau) {
	const run = new TextRun({ text });
	const num = numeroDeTitre(text);
	const ancre = num && ancreDe(num);
	const pose = ancre && ancresConnues.has(ancre) && !ancresPosees.has(ancre);
	if (pose) ancresPosees.add(ancre);
	return new Paragraph({
		heading: niveau,
		children: pose ? [new Bookmark({ id: ancre, children: [run] })] : [run],
	});
}

const sectionHeading = (text) => heading(text, HeadingLevel.HEADING_1);

const subHeading = (text) => heading(text, HeadingLevel.HEADING_2);

const subSubHeading = (text) => heading(text, HeadingLevel.HEADING_3);

const CLOTURE = /^\s*fait à /i;

const body = (text) =>
	new Paragraph({
		spacing: { after: 120, line: 259, ...(CLOTURE.test(text) ? { before: 480 } : {}) },
		children: runs(text),
	});

const bullet = (text) =>
	new Paragraph({ bullet: { level: 0 }, spacing: { after: 60, line: 259 }, children: runs(text) });

const callout = (lines) =>
	new Table({
		width: { size: CONTENT_DXA, type: WidthType.DXA },
		columnWidths: [CONTENT_DXA],
		layout: TableLayoutType.FIXED,
		borders: {
			top: noBorder,
			bottom: noBorder,
			right: noBorder,
			insideHorizontal: noBorder,
			insideVertical: noBorder,
			left: { style: BorderStyle.SINGLE, size: 18, color: FILET },
		},
		rows: [
			new TableRow({
				children: [
					new TableCell({
						width: { size: CONTENT_DXA, type: WidthType.DXA },
						shading: { fill: "F2F2F2" },
						margins: { top: 120, bottom: 120, left: 200, right: 200 },
						children: lines.map((l) => new Paragraph({ spacing: { after: 40 }, children: runs(l) })),
					}),
				],
			}),
		],
	});

const TAILLES = [10.5, 9.5, 8.5, 8];
const COURTE = 5;

function dimensionnerTableau(rows, { utile, carParPt, pad }) {
	const cols = Math.max(1, ...rows.map((r) => r.length));
	const mesures = () => ({ mot: Array(cols).fill(4), poids: Array(cols).fill(1) });
	const tout = mesures();
	const corps = mesures();
	const courte = Array(cols).fill(true);
	rows.forEach((r, i) =>
		r.forEach((c, j) => {
			const txt = String(c || "").replace(/[*`]/g, "");
			for (const cible of i === 0 ? [tout] : [tout, corps]) {
				cible.poids[j] = Math.max(cible.poids[j], Math.sqrt(txt.length));
				for (const m of txt.split(/\s+/)) cible.mot[j] = Math.max(cible.mot[j], m.length);
			}
			if (i > 0 && txt.trim().length > COURTE) courte[j] = false;
		}),
	);
	const plafond = Math.floor((2 * utile) / cols);
	const planchers = (mot, pt) => mot.map((n) => Math.min(plafond, Math.ceil(n * pt * carParPt) + pad));
	const tientEn = (mot, pt) => planchers(mot, pt).reduce((a, b) => a + b, 0) < utile;

	let mesure = tout;
	let enTeteVertical = false;
	let pt = TAILLES.find((t) => tientEn(tout.mot, t));
	if (!pt) {
		pt = TAILLES.find((t) => tientEn(corps.mot, t));
		if (pt) {
			mesure = corps;
			enTeteVertical = true;
		}
	}
	if (!pt) pt = TAILLES[TAILLES.length - 1];

	const mins = planchers(mesure.mot, pt);
	const socle = mins.reduce((a, b) => a + b, 0);
	const centrees = courte.map((c, j) => c && j > 0);
	const enTete = (j) =>
		String((rows[0] || [])[j] || "")
			.replace(/[*`]/g, "")
			.trim();
	const motLePlusLong = (t) => Math.max(0, ...t.split(/\s+/).map((m) => m.length));
	const enroule = (mots, large) => {
		let lignes = 1;
		let reste = large;
		for (const m of mots) {
			if (m.length <= reste) reste -= m.length + 1;
			else {
				lignes++;
				reste = large - m.length - 1;
			}
		}
		return lignes;
	};
	const hauteurTitre = (texte, largeur) => {
		const mots = texte.split(/\s+/).filter(Boolean);
		if (!mots.length) return 0;
		const lignesDispo = Math.max(1, Math.floor(largeur / (pt * 24)));
		let large = texte.length;
		for (let l = motLePlusLong(texte); l < texte.length; l++)
			if (enroule(mots, l) <= lignesDispo) {
				large = l;
				break;
			}
		return Math.ceil(large * pt * carParPt) + pad;
	};
	const finaliser = (widths) => {
		const verticales = widths.map(
			(w, j) => enTeteVertical && (j > 0 || motLePlusLong(enTete(j)) * pt * carParPt + pad > w),
		);
		const hauteur = Math.max(0, ...verticales.map((v, j) => (v ? hauteurTitre(enTete(j), widths[j]) : 0)));
		return { pt, widths, centrees, verticales, hauteurEnTete: Math.min(2600, hauteur) };
	};
	if (socle >= utile) return finaliser(mins.map((m) => Math.floor((utile * m) / socle)));
	const fige = Array(cols).fill(false);
	let widths = mins.slice();
	for (let tour = 0; tour <= cols; tour++) {
		const pris = mins.reduce((s, m, j) => s + (fige[j] ? m : 0), 0);
		const libres = mesure.poids.reduce((s, p, j) => s + (fige[j] ? 0 : p), 0) || 1;
		widths = mesure.poids.map((p, j) => (fige[j] ? mins[j] : Math.floor(((utile - pris) * p) / libres)));
		const sousMin = widths.findIndex((w, j) => !fige[j] && w < mins[j]);
		if (sousMin === -1) break;
		fige[sousMin] = true;
	}
	return finaliser(widths);
}

function makeTable(rows) {
	const border = { style: BorderStyle.SINGLE, size: 4, color: FILET };
	const { pt, widths, verticales, centrees, hauteurEnTete } = dimensionnerTableau(rows, {
		utile: CONTENT_DXA,
		carParPt: 12,
		pad: 260,
	});
	const cols = widths.length;
	const cell = (txt, j, header, zebre) => {
		const vertical = header && verticales[j];
		return new TableCell({
			width: { size: widths[j], type: WidthType.DXA },
			shading: header ? { fill: ENTETE } : zebre ? { fill: ZEBRE } : undefined,
			margins: { top: 60, bottom: 60, left: 110, right: 110 },
			...(vertical ? { textDirection: TextDirection.BOTTOM_TO_TOP_LEFT_TO_RIGHT } : {}),
			...(header && hauteurEnTete ? { verticalAlign: VerticalAlign.BOTTOM } : {}),
			children: [
				new Paragraph({
					alignment: centrees[j] && !vertical ? AlignmentType.CENTER : undefined,
					children: header
						? [new TextRun({ text: txt || "", bold: true, color: ENCRE, font: FONT, size: HP(pt) })]
						: runs(txt || "", { size: HP(pt) }),
				}),
			],
		});
	};
	return new Table({
		width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
		columnWidths: widths,
		layout: TableLayoutType.FIXED,
		borders: {
			top: border,
			bottom: border,
			left: border,
			right: border,
			insideHorizontal: border,
			insideVertical: border,
		},
		rows: rows.map((r, i) => {
			const cells = [...r];
			while (cells.length < cols) cells.push("");
			return new TableRow({
				tableHeader: i === 0,
				...(i === 0 && hauteurEnTete ? { height: { value: hauteurEnTete, rule: HeightRule.ATLEAST } } : {}),
				children: cells.map((c, j) => cell(c, j, i === 0, i > 0 && i % 2 === 0)),
			});
		}),
	});
}

function parseBlocks(md) {
	const lines = String(md)
		.replace(/<!--[\s\S]*?-->/g, "")
		.split("\n");
	const blocks = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i].replace(/\s+$/, "");
		if (/^\s*\|(.+)\|\s*$/.test(line)) {
			const rows = [];
			while (i < lines.length && /^\s*\|(.+)\|\s*$/.test(lines[i])) {
				if (!/^\s*\|[\s|:-]+\|\s*$/.test(lines[i]))
					rows.push(
						lines[i]
							.trim()
							.replace(/^\||\|$/g, "")
							.split("|")
							.map((c) => c.trim()),
					);
				i++;
			}
			blocks.push({ t: "table", rows });
			continue;
		}
		let m;
		if ((m = line.match(/^#\s+(.*)/))) blocks.push({ t: "h1", text: m[1] });
		else if ((m = line.match(/^##\s+(.*)/))) blocks.push({ t: "h2", text: m[1] });
		else if ((m = line.match(/^#{4,}\s+(.*)/))) blocks.push({ t: "h4", text: m[1] });
		else if ((m = line.match(/^###\s+(.*)/))) blocks.push({ t: "h3", text: m[1] });
		else if ((m = line.match(/^>\s?(.*)/))) {
			const q = [m[1]];
			while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1])) q.push(lines[++i].replace(/^>\s?/, ""));
			blocks.push({ t: "quote", lines: q.filter((x) => x.trim()) });
		} else if ((m = line.match(/^\s*[-*]\s+(.*)/))) blocks.push({ t: "li", text: m[1] });
		else if (line.trim() === "---") blocks.push({ t: "hr" });
		else if (line.trim()) blocks.push({ t: "p", text: line.trim() });
		i++;
	}
	return blocks;
}

const headingStyles = [
	{
		id: "Heading1",
		name: "Heading 1",
		basedOn: "Normal",
		next: "Normal",
		quickFormat: true,
		run: { font: FONT, size: HP(14), color: H1, bold: false },
		paragraph: { spacing: { before: 240, after: 60 }, keepNext: true, outlineLevel: 0 },
	},
	{
		id: "Heading2",
		name: "Heading 2",
		basedOn: "Normal",
		next: "Normal",
		quickFormat: true,
		run: { font: FONT, size: HP(13), color: H2, bold: false },
		paragraph: { spacing: { before: 160, after: 40 }, keepNext: true, outlineLevel: 1 },
	},
	{
		id: "Heading3",
		name: "Heading 3",
		basedOn: "Normal",
		next: "Normal",
		quickFormat: true,
		run: { font: FONT, size: HP(11.5), color: H2, bold: true },
		paragraph: { spacing: { before: 120, after: 20 }, keepNext: true, outlineLevel: 2 },
	},
];

const stripFences = (s) => String(s || "").replace(/^```(?:markdown|md)?\s*|\s*```$/g, "");

function sansTirets(s) {
	let t = String(s || "");
	t = t.replace(/(\d)\s*[—–]\s*(\d)/g, "$1-$2");
	t = t.replace(/^(\s*)[—–]\s+/gm, "$1- ");
	t = t.replace(/^(\s*#{1,6} .+?)\s*[—–]\s*/gm, "$1 : ");
	t = t.replace(/^(\s*(?:[-*]\s+|\d+\.\s+)?[A-ZÀ-ÖØ-Þ][A-ZÀ-ÖØ-Þ0-9 ,'’()/«».&]{2,}?)\s*[—–]\s*/gm, "$1 : ");
	t = t.replace(/\s*[—–]\s*/g, ", ");
	return t;
}

const escapeHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inlineHtml(text) {
	let out = "";
	const re = /(\[À COMPLÉTER[^\]]*\])|\*\*(.+?)\*\*|`(.+?)`|_\*\*(.+?)\*\*_|\*(.+?)\*/g;
	let last = 0;
	let m;
	while ((m = re.exec(text))) {
		out += escapeHtml(text.slice(last, m.index));
		if (m[1]) out += `<mark>${escapeHtml(m[1])}</mark>`;
		else if (m[2] !== undefined) out += `<strong>${escapeHtml(m[2])}</strong>`;
		else if (m[3] !== undefined) out += `<code>${escapeHtml(m[3])}</code>`;
		else if (m[4] !== undefined) out += `<em><strong>${escapeHtml(m[4])}</strong></em>`;
		else if (m[5] !== undefined) out += `<em>${escapeHtml(m[5])}</em>`;
		last = re.lastIndex;
	}
	out += escapeHtml(text.slice(last));
	return out;
}

function toHtml(md) {
	const blocks = parseBlocks(md);
	let html = "";
	let list = [];
	const flush = () => {
		if (list.length) html += "<ul>" + list.map((t) => `<li>${inlineHtml(t)}</li>`).join("") + "</ul>";
		list = [];
	};
	for (const b of blocks) {
		if (b.t !== "li") flush();
		if (b.t === "h1") html += `<h1>${inlineHtml(b.text)}</h1>`;
		else if (b.t === "h2") html += `<h2>${inlineHtml(b.text)}</h2>`;
		else if (b.t === "h3") html += `<h3>${inlineHtml(b.text)}</h3>`;
		else if (b.t === "h4") html += `<h4>${inlineHtml(b.text)}</h4>`;
		else if (b.t === "p") html += `<p>${inlineHtml(b.text)}</p>`;
		else if (b.t === "li") list.push(b.text);
		else if (b.t === "hr") html += "<hr>";
		else if (b.t === "quote")
			html += `<blockquote>${b.lines.map((l) => `<p>${inlineHtml(l)}</p>`).join("")}</blockquote>`;
		else if (b.t === "table") {
			html += "<table>";
			b.rows.forEach((r, i) => {
				const tag = i === 0 ? "th" : "td";
				html += "<tr>" + r.map((c) => `<${tag}>${inlineHtml(c)}</${tag}>`).join("") + "</tr>";
			});
			html += "</table>";
		}
	}
	flush();
	return html;
}

const LARGEUR_UTILE_PX = 950;
const HAUTEUR_UTILE_PX = 570;

function annexesParagraphs(annexes) {
	const out = [];
	for (const a of Array.isArray(annexes) ? annexes : []) {
		let data = null;
		try {
			data = fs.readFileSync(a.image);
		} catch {
			continue;
		}
		if (data.length < 24 || data.readUInt32BE(12) !== 0x49484452) continue;
		const w = data.readUInt32BE(16);
		const h = data.readUInt32BE(20);
		if (!w || !h) continue;
		const echelle = Math.min(LARGEUR_UTILE_PX / w, HAUTEUR_UTILE_PX / h, 1);
		const width = Math.round(w * echelle);
		if (out.length) out.push(new Paragraph({ children: [new PageBreak()] }));
		out.push(
			sectionHeading(a.titre),
			new Paragraph({
				alignment: AlignmentType.CENTER,
				spacing: { before: 120, after: 120 },
				children: [new ImageRun({ type: "png", data, transformation: { width, height: Math.round(h * echelle) } })],
			}),
		);
	}
	return out;
}

function render(md, title, annexes, opts = {}) {
	const blocks = parseBlocks(md);
	const children = [];
	let k = 0;
	let hadCover = false;

	if (blocks[k] && blocks[k].t === "h1") {
		children.push(
			new Paragraph({
				spacing: { before: 360, after: 60 },
				children: [new TextRun({ text: blocks[k].text, color: H1, font: FONT, size: HP(28) })],
			}),
		);
		k++;
		if (blocks[k] && blocks[k].t === "h2") {
			children.push(
				new Paragraph({
					spacing: { after: 80 },
					children: [new TextRun({ text: blocks[k].text, color: ENCRE, font: FONT, size: HP(14) })],
				}),
			);
			k++;
		}
		while (blocks[k] && blocks[k].t === "p") {
			children.push(
				new Paragraph({ spacing: { after: 20 }, children: runs(blocks[k].text, { color: GRIS, size: HP(11) }) }),
			);
			k++;
		}
		if (blocks[k] && blocks[k].t === "hr") k++;
		hadCover = true;
	}

	const hasHeadings = blocks.slice(k).some((b) => b.t === "h1" || b.t === "h2" || b.t === "h3");
	if (hasHeadings && !opts.sansSommaire) {
		if (hadCover) children.push(new Paragraph({ children: [new PageBreak()] }));
		children.push(
			new Paragraph({
				spacing: { before: 120, after: 120 },
				children: [new TextRun({ text: "Sommaire", color: H1, font: FONT, size: HP(14) })],
			}),
			new TableOfContents("Sommaire", { hyperlink: true, headingStyleRange: "1-2" }),
			new Paragraph({ children: [new PageBreak()] }),
		);
	}

	ancresConnues = new Set(
		blocks
			.slice(k)
			.filter((b) => b.t === "h1" || b.t === "h2" || b.t === "h3" || b.t === "h4")
			.map((b) => numeroDeTitre(b.text))
			.filter(Boolean)
			.map(ancreDe),
	);
	ancresPosees = new Set();

	let pendingList = [];
	const flushList = () => {
		pendingList.forEach((it) => children.push(bullet(it)));
		pendingList = [];
	};
	for (; k < blocks.length; k++) {
		const b = blocks[k];
		if (b.t !== "li") flushList();
		if (b.t === "h1") children.push(sectionHeading(b.text));
		else if (b.t === "h2") children.push(sectionHeading(b.text));
		else if (b.t === "h3") children.push(subHeading(b.text));
		else if (b.t === "h4") children.push(subSubHeading(b.text));
		else if (b.t === "p") children.push(body(b.text));
		else if (b.t === "li") pendingList.push(b.text);
		else if (b.t === "table") children.push(makeTable(b.rows), new Paragraph({ spacing: { after: 60 }, children: [] }));
		else if (b.t === "quote") children.push(callout(b.lines), new Paragraph({ spacing: { after: 60 }, children: [] }));
		else if (b.t === "hr")
			children.push(
				new Paragraph({
					spacing: { after: 40 },
					border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: FILET } },
					children: [new TextRun({ text: "" })],
				}),
			);
	}
	flushList();
	const pagesAnnexes = annexesParagraphs(annexes);

	const logoEntete = logoRun(LOGO_SOMBRE, 118);
	const enTete = new Header({
		children: [
			new Paragraph({
				alignment: AlignmentType.RIGHT,
				border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: FILET, space: 6 } },
				spacing: { after: 60 },
				children: logoEntete ? [logoEntete] : [new TextRun({ text: "" })],
			}),
		],
	});

	const piedDePage = new Footer({
		children: [
			new Paragraph({
				alignment: AlignmentType.RIGHT,
				border: { top: { style: BorderStyle.SINGLE, size: 4, color: FILET, space: 4 } },
				children: [
					new TextRun({ text: `${title || "Galadrim"}    `, size: HP(8), color: GRIS, font: FONT }),
					new TextRun({ children: [PageNumber.CURRENT], size: HP(8), color: GRIS, font: FONT }),
				],
			}),
		],
	});

	const marges = { top: 1440, bottom: 1134, left: 1134, right: 1134, header: 567, footer: 567 };
	const doc = new Document({
		features: { updateFields: true },
		styles: {
			default: { document: { run: { font: FONT, size: HP(11), color: ENCRE } } },
			paragraphStyles: headingStyles,
		},
		sections: [
			{
				properties: { titlePage: true, page: { margin: marges } },
				headers: {
					default: enTete,
					first: new Header({ children: [] }),
				},
				footers: {
					default: piedDePage,
					first: new Footer({ children: [] }),
				},
				children,
			},
			...(pagesAnnexes.length
				? [
						{
							properties: { page: { margin: marges, size: { orientation: PageOrientation.LANDSCAPE } } },
							headers: { default: enTete },
							footers: { default: piedDePage },
							children: pagesAnnexes,
						},
					]
				: []),
		],
	});
	return Packer.toBuffer(doc);
}

module.exports = {
	render,
	stripFences,
	sansTirets,
	toHtml,
	parseBlocks,
	dimensionnerTableau,
	numeroDeTitre,
	ancreDe,
};
