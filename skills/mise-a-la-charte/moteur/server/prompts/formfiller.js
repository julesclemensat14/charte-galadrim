// Remplace server/prompts/formfiller.js dans le skill distribué : le moteur du mémoire n'en prend que la
// conversion en PDF, qui sert à poser les vrais numéros de page du sommaire.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

async function toPdf(src) {
	try {
		// Profil LibreOffice à part : sans lui, la conversion échoue en silence si LibreOffice est ouvert.
		const profil = fs.mkdtempSync(path.join(os.tmpdir(), "charte_lo_"));
		execFileSync(
			"soffice",
			[`-env:UserInstallation=file://${profil}`, "--headless", "--convert-to", "pdf", "--outdir", path.dirname(src), src],
			{ stdio: "ignore" },
		);
		return fs.readFileSync(src.replace(/\.docx$/, ".pdf"));
	} catch {
		return null;
	}
}

module.exports = { toPdf };
