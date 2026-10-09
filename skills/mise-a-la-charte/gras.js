// Le gras d'un PDF, page par page : pdftotext ne le rend pas, les polices du PDF le disent.
// Usage : node gras.js document.pdf   → « p7: Next.js ¦ React » (passages en gras, dans l'ordre)
const fs = require("fs");
const { getDocument } = require("pdfjs-dist/legacy/build/pdf.mjs");

(async () => {
	const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(process.argv[2])), verbosity: 0 }).promise;
	for (let p = 1; p <= doc.numPages; p++) {
		const page = await doc.getPage(p);
		const { items } = await page.getTextContent();
		await page.getOperatorList(); // charge les polices, dont le nom dit la graisse
		const passages = [];
		let courant = "";
		for (const it of items) {
			const police = page.commonObjs.has(it.fontName) ? page.commonObjs.get(it.fontName).name : "";
			if (/bold|black|heavy/i.test(police || "")) courant += it.str + (it.hasEOL ? " " : "");
			else if (courant.trim()) {
				passages.push(courant.trim());
				courant = "";
			}
		}
		if (courant.trim()) passages.push(courant.trim());
		if (passages.length) console.log(`p${p}: ${passages.join(" ¦ ")}`);
	}
})();
