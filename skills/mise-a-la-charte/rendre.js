// Rend un contenu Markdown dans le gabarit du mémoire technique (templates/reference.docx), puis en PDF.
// Usage : node rendre.js contenu.md meta.json sortie.docx   (champs de meta.json : SKILL.md, étape 1)
//
// contenu.md : le corps seul (« ## » = titre de partie). Une ligne ![légende](image) devient une figure
// du gabarit, sans légende imprimée si elle est vide.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
// Dans le projet, le moteur de l'outil ; dans le skill distribué (scripts/publier-charte.sh), sa copie
// embarquée dans moteur/.
const MOTEUR = fs.existsSync(path.join(__dirname, "moteur")) ? "./moteur/server/" : "../../../server/";
const { render } = require(`${MOTEUR}docxtemplate`);
const { toPdf } = require(`${MOTEUR}prompts/formfiller`);

(async () => {
	const [md, metaJson, sortie] = process.argv.slice(2);
	if (!sortie) throw new Error("usage : rendre.js contenu.md meta.json sortie.docx");
	const meta = JSON.parse(fs.readFileSync(metaJson, "utf8"));
	const pdfSortie = sortie.replace(/\.docx$/, ".pdf");

	// Le moteur ne pose que des PNG, appariés au corps par le texte de leur légende : deux légendes
	// identiques poseraient deux fois la même image.
	const figuresCorps = [];
	const corps = fs.readFileSync(md, "utf8").replace(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/gm, (_, legende, image) => {
		const n = figuresCorps.length + 1;
		if (!/\.png$/i.test(image)) {
			const png = path.join(path.dirname(path.resolve(sortie)), `image-${n}.png`);
			execFileSync("sips", ["-s", "format", "png", image, "--out", png], { stdio: "ignore" });
			image = png;
		}
		const cle = legende.trim() || `⟦image ${n}⟧`;
		if (figuresCorps.some((f) => f.legende === cle)) throw new Error(`deux images légendées « ${cle} »`);
		figuresCorps.push({ legende: cle, image, muette: !legende.trim() });
		return cle;
	});

	// sansDefauts : la charte habille tout document, Galadrim ou non ; rien n'est prérempli.
	fs.writeFileSync(sortie, await render(corps, { ...meta, sansDefauts: true, figuresCorps }));
	const pdf = await toPdf(sortie);
	if (!pdf) throw new Error("conversion en PDF impossible : LibreOffice absent ou en échec");
	fs.writeFileSync(pdfSortie, pdf);
	console.log(`${sortie}\n${pdfSortie}`);
})();
