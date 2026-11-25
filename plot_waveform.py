"""Trace un chronogramme a partir de relu_simulation.vcd (sortie Icarus).

Usage :
    python plot_waveform.py

Produit docs/chronogramme.png. Ne depend que de matplotlib.
"""

from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

PROJET = Path(__file__).resolve().parent
VCD = PROJET / "relu_simulation.vcd"
SORTIE = PROJET / "docs" / "chronogramme.png"

# Signaux du module tb_mac_relu a afficher, dans l'ordre
SIGNAUX = ["clk", "reset", "a", "b", "acc", "relu_out"]
SCOPE_TOP = "tb_mac_relu"


def lire_vcd(chemin):
    """Retourne {nom: (largeur, [(temps_ns, valeur_brute), ...])}."""
    ids = {}          # identifiant VCD -> nom
    largeurs = {}     # nom -> largeur en bits
    changements = {nom: [] for nom in SIGNAUX}
    scope = []
    temps = 0
    timescale_ps = 1

    with open(chemin, encoding="ascii") as f:
        lignes = f.read().split("\n")

    en_definitions = True
    for ligne in lignes:
        ligne = ligne.strip()
        if not ligne:
            continue
        if en_definitions:
            if ligne.startswith("$scope"):
                scope.append(ligne.split()[2])
            elif ligne.startswith("$upscope"):
                scope.pop()
            elif ligne.startswith("$var"):
                parties = ligne.split()
                largeur, ident, nom = int(parties[2]), parties[3], parties[4]
                if scope == [SCOPE_TOP] and nom in SIGNAUX:
                    ids[ident] = nom
                    largeurs[nom] = largeur
            elif ligne.startswith("$enddefinitions"):
                en_definitions = False
            continue

        if ligne.startswith("#"):
            temps = int(ligne[1:]) * timescale_ps / 1000.0  # ps -> ns
        elif ligne[0] in "01xzXZ" and len(ligne) > 1 and ligne[1:] in ids:
            changements[ids[ligne[1:]]].append((temps, ligne[0]))
        elif ligne[0] == "b":
            valeur, ident = ligne[1:].split()
            if ident in ids:
                changements[ids[ident]].append((temps, valeur))

    return largeurs, changements


def en_entier_signe(bits, largeur):
    """Convertit une chaine binaire en entier signe, None si inconnue."""
    if not all(c in "01" for c in bits):
        return None
    valeur = int(bits, 2)
    if valeur >= 2 ** (largeur - 1):
        valeur -= 2 ** largeur
    return valeur


def tracer(largeurs, changements, sortie):
    fin = max(t for chg in changements.values() for t, _ in chg)
    fin = max(fin, 1.0)

    fig, axes = plt.subplots(len(SIGNAUX), 1, figsize=(10, 6.5), sharex=True)

    for ax, nom in zip(axes, SIGNAUX):
        chg = changements[nom]
        largeur = largeurs[nom]
        ax.set_ylabel(nom, rotation=0, ha="right", va="center")
        ax.set_yticks([])
        ax.set_xlim(0, fin + 2)

        if largeur == 1:
            # Signal logique : trace en escalier
            temps = [t for t, _ in chg] + [fin + 2]
            niveaux = [1 if v == "1" else 0 for _, v in chg] + [chg[-1][1] == "1"]
            ax.step(temps, niveaux, where="post", color="tab:green")
            ax.set_ylim(-0.3, 1.3)
        else:
            # Bus : valeur signee affichee a chaque changement
            for i, (t, bits) in enumerate(chg):
                t_fin = chg[i + 1][0] if i + 1 < len(chg) else fin + 2
                valeur = en_entier_signe(bits, largeur)
                texte = "x" if valeur is None else str(valeur)
                ax.fill_betweenx([0, 1], t, t_fin, color="tab:blue", alpha=0.15)
                ax.plot([t, t], [0, 1], color="tab:blue", linewidth=0.8)
                ax.text((t + t_fin) / 2, 0.5, texte, ha="center", va="center", fontsize=8)
            ax.set_ylim(0, 1)

    axes[-1].set_xlabel("Temps (ns)")
    fig.suptitle("Chronogramme MAC + ReLU (tb_mac_relu, Icarus Verilog)")
    fig.tight_layout()
    sortie.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(sortie, dpi=150)
    print(f"Chronogramme enregistre : {sortie}")


if __name__ == "__main__":
    largeurs, changements = lire_vcd(VCD)
    tracer(largeurs, changements, SORTIE)
