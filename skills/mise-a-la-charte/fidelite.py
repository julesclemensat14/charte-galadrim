# Liste les mots et les nombres (à part) du document source absents du document à la charte.
# Usage : python3 -I fidelite.py source.pdf sortie.pdf   (un Word source se convertit d'abord en PDF)
import collections
import re
import subprocess
import sys


def mots(pdf):
	texte = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True).stdout
	texte = re.sub(r"-\n(?=\w)", "", texte).replace("’", "'")  # coupures de fin de ligne, apostrophe courbe
	return collections.Counter(m.lower() for m in re.findall(r"\w[\w'-]*", texte))


source, sortie = mots(sys.argv[1]), mots(sys.argv[2])
manquants = {m: n - sortie[m] for m, n in source.items() if n > sortie[m]}
total = sum(source.values())
perdus = sum(manquants.values())
print(f"{total} mots dans la source, {perdus} absents du résultat ({perdus / max(total, 1):.1%})")
for titre, garder in (("Mots", lambda m: not m.isdigit()), ("Nombres", str.isdigit)):
	liste = sorted(((m, n) for m, n in manquants.items() if garder(m)), key=lambda x: -x[1])
	if liste:
		print(f"{titre} :")
		for m, n in liste[:60]:
			print(f"  {m} ×{n}")
