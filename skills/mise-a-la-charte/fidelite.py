# Liste les mots du document source absents du document à la charte : le contenu doit passer en entier.
# Le résultat ajoute des mots (couverture, sommaire, numéros, en-têtes) ; on ne cherche que ceux qui manquent.
# Usage : python3 -I fidelite.py source.pdf sortie.pdf   (un Word source se convertit d'abord en PDF)
import collections
import re
import subprocess
import sys


def mots(pdf):
	texte = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True).stdout
	texte = re.sub(r"-\n(?=\w)", "", texte).replace("’", "'")  # coupures de fin de ligne, apostrophe courbe
	return collections.Counter(m.lower() for m in re.findall(r"\w[\w'-]*", texte) if not m.isdigit())


source, sortie = mots(sys.argv[1]), mots(sys.argv[2])
manquants = {m: n - sortie[m] for m, n in source.items() if n > sortie[m]}
total = sum(source.values())
perdus = sum(manquants.values())
print(f"{total} mots dans la source, {perdus} absents du résultat ({perdus / max(total, 1):.1%})")
for m, n in sorted(manquants.items(), key=lambda x: -x[1])[:60]:
	print(f"  {m} ×{n}")
