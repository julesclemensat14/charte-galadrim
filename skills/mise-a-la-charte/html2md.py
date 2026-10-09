# Convertit le HTML que LibreOffice tire d'un Word (soffice --convert-to html) en Markdown du mémoire,
# texte recopié tel quel. Titres décalés d'un cran : « # » est réservé à la couverture, le corps commence
# à « ## » (Heading1 du gabarit). Les images restent des lignes ![](chemin) que rendre.js pose en figures.
# Usage : python3 -I html2md.py document.html > contenu.md
import html.parser
import os
import re
import sys

MARQUE = {"b": "**", "strong": "**", "i": "*", "em": "*"}
TITRES = {"h1": "##", "h2": "###", "h3": "####", "h4": "####", "h5": "####", "h6": "####"}


class Md(html.parser.HTMLParser):
	def __init__(self, dossier):
		super().__init__()
		self.dossier, self.out, self.buf, self.listes = dossier, [], "", []
		self.cellules = None
		self.titre = self.ignore = self.tables = 0
		self.images = []  # images vues dans un tableau : posées sous lui, une ligne d'image le couperait
		self.marques = []  # gras et italique ouverts : (balise, position dans buf)

	# Un gras ou un italique vide (fréquent dans un Word) ne laisse aucune marque : « **** » ou « ** »
	# seraient relus comme l'ouverture d'un autre gras.
	def ouvrir(self, tag):
		self.marques.append((tag, len(self.buf)))
		self.buf += MARQUE[tag]

	def fermer(self, tag):
		if not self.marques or self.marques[-1][0] != tag:
			return
		debut = self.marques.pop()[1] + len(MARQUE[tag])
		if self.buf[debut:].strip():
			self.buf += MARQUE[tag]
		else:
			self.buf = self.buf[: debut - len(MARQUE[tag])] + self.buf[debut:]

	def flush(self):
		# Un gras coupé par un retour à la ligne se ferme ici et se rouvre sur la ligne suivante.
		ouverts = [tag for tag, _ in self.marques]
		for tag in reversed(ouverts):
			self.fermer(tag)
		texte = re.sub(r"\s+", " ", self.buf).strip()
		self.buf, self.marques = "", []
		for tag in ouverts:
			self.ouvrir(tag)
		if not texte:
			return
		if self.cellules is not None:
			self.cellules[-1] += (" " if self.cellules[-1] else "") + texte.replace("|", "/")
		elif self.titre:
			self.out.append(f"\n{TITRES[self.titre]} {texte.replace('**', '')}\n")
		elif self.listes:
			puce = "-" if self.listes[-1][0] == "ul" else f"{self.listes[-1][1]}."
			self.out.append(f"{puce} {texte}")
		elif re.match(r"[•◦▪–]\s", texte):  # puce tapée à la main dans le Word
			self.out.append(f"- {texte[2:]}")
		else:
			self.out.append(f"\n{texte}\n")

	def handle_starttag(self, tag, attrs):
		a = dict(attrs)
		if tag in ("style", "script", "title"):
			self.ignore += 1
		elif tag in TITRES:
			self.flush()
			self.titre = tag
		elif tag in ("p", "div", "br"):
			if self.cellules is None:
				self.flush()
			else:
				self.buf += " "
		elif tag in ("ul", "ol"):
			self.flush()
			self.listes.append([tag, 0])
		elif tag == "li":
			self.flush()
			self.listes[-1][1] += 1
		elif tag == "table":
			# Un tableau dans une case se lit comme du texte de cette case.
			self.tables += 1
			if self.tables == 1:
				self.flush()
				self.out.append("")
			else:
				self.buf += " "
		elif tag == "tr" and self.tables == 1:
			self.cellules = []
		elif tag in ("td", "th") and self.tables == 1 and self.cellules is not None:
			self.flush()
			self.cellules.append("")
		elif tag in MARQUE:
			self.ouvrir(tag)
		elif tag == "img" and a.get("src"):
			ligne = f"![]({os.path.join(self.dossier, a['src'])})"
			if self.tables:
				self.images.append(ligne)
			else:
				self.flush()
				self.out.append(f"\n{ligne}\n")

	def handle_endtag(self, tag):
		if tag in ("style", "script", "title"):
			self.ignore -= 1
		elif tag in TITRES:
			self.flush()
			self.titre = 0
		elif tag in ("p", "div", "li"):
			if self.cellules is None:
				self.flush()
		elif tag in ("ul", "ol"):
			self.flush()
			self.listes.pop()
		elif tag in ("td", "th"):
			if self.tables == 1:
				self.flush()
			else:
				self.buf += " "
		elif tag == "tr" and self.tables == 1 and self.cellules is not None:
			if any(self.cellules):
				premiere = not self.out or not self.out[-1].startswith("|")
				if premiere:  # l'en-tête du gabarit est déjà en gras et ne lit pas les « ** »
					self.cellules = [c.replace("**", "") for c in self.cellules]
				self.out.append("| " + " | ".join(self.cellules) + " |")
				if premiere:
					self.out.append("|" + "---|" * len(self.cellules))
			self.cellules = None
		elif tag == "table" and self.tables:
			self.tables -= 1
			if not self.tables:
				self.out += ["", *(f"{ligne}\n" for ligne in self.images)]
				self.images = []
		elif tag in MARQUE:
			self.fermer(tag)

	def handle_data(self, data):
		if not self.ignore:
			self.buf += data


chemin = sys.argv[1]
md = Md(os.path.dirname(os.path.abspath(chemin)))
md.feed(open(chemin, encoding="utf-8", errors="replace").read())
md.flush()
texte = "\n".join(md.out)
print(re.sub(r"\n{3,}", "\n\n", texte).strip())
